import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import MongoStore from 'connect-mongo';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import mongoose from 'mongoose';

const app = express();
const port = Number(process.env.PORT) || 3000;
const mongoUri = process.env.MONGODB_URI;
const sessionSecret = process.env.SESSION_SECRET;
const sessionCookieName = 'agrisense.sid';
const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 24 * 7,
};
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

if (!mongoUri) {
  throw new Error('MONGODB_URI is required. Copy .env.example to .env and configure MongoDB.');
}

if (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith('replace-with-')) {
  throw new Error('Set SESSION_SECRET in .env to a random value at least 32 characters long.');
}

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
}, { timestamps: true });

const planSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  crop: { type: String, enum: ['maize', 'wheat', 'rice', 'tomato', 'cotton'], required: true },
  area: { type: Number, min: 0.1, max: 100000, required: true },
  ph: { type: Number, min: 3, max: 10, required: true },
  nitrogen: { type: String, enum: ['low', 'medium', 'high'], required: true },
  phosphorus: { type: String, enum: ['low', 'medium', 'high'], required: true },
  potassium: { type: String, enum: ['low', 'medium', 'high'], required: true },
  rainfall: { type: Number, min: 0, max: 2000, required: true },
  sunshineHours: { type: Number, min: 0, max: 168 },
  temperatureMin: { type: Number, min: -100, max: 70 },
  temperatureMax: { type: Number, min: -100, max: 70 },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Plan = mongoose.model('Plan', planSchema);

await mongoose.connect(mongoUri);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'https://api.open-meteo.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    },
  },
}));
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('origin')) {
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    if (req.get('origin') !== requestOrigin) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
  }
  next();
});

app.use(session({
  name: sessionCookieName,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    client: mongoose.connection.getClient(),
    collectionName: 'sessions',
    ttl: 60 * 60 * 24 * 7,
  }),
  cookie: sessionCookieOptions,
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many account requests. Please try again in a few minutes.' },
});

function requireUser(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Please sign in to access saved plans.' });
  }
  next();
}

function validEmail(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= 72
    && value.length >= 8;
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;

    if (!validEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!validPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 bytes.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash });
    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');

    if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    if (!req.session.userId) return res.json({ user: null });
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.userId = null;
      return res.json({ user: null });
    }
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    if (req.session) {
      await new Promise((resolve, reject) => {
        req.session.destroy((error) => error ? reject(error) : resolve());
      });
    }
    res.clearCookie(sessionCookieName, { ...sessionCookieOptions, maxAge: undefined });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

const allowedCrops = new Set(['maize', 'wheat', 'rice', 'tomato', 'cotton']);
const allowedRatings = new Set(['low', 'medium', 'high']);

function validPlanInput(input) {
  return input
    && allowedCrops.has(input.crop)
    && Number.isFinite(input.area) && input.area >= 0.1 && input.area <= 100000
    && Number.isFinite(input.ph) && input.ph >= 3 && input.ph <= 10
    && allowedRatings.has(input.nitrogen)
    && allowedRatings.has(input.phosphorus)
    && allowedRatings.has(input.potassium)
    && Number.isFinite(input.rainfall) && input.rainfall >= 0 && input.rainfall <= 2000
    && ((input.sunshineHours === undefined
      && input.temperatureMin === undefined
      && input.temperatureMax === undefined)
      || (Number.isFinite(input.sunshineHours) && input.sunshineHours >= 0 && input.sunshineHours <= 168
        && Number.isFinite(input.temperatureMin) && input.temperatureMin >= -100 && input.temperatureMin <= 70
        && Number.isFinite(input.temperatureMax) && input.temperatureMax >= input.temperatureMin && input.temperatureMax <= 70));
}

app.get('/api/plans', requireUser, async (req, res, next) => {
  try {
    const plans = await Plan.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('crop area ph nitrogen phosphorus potassium rainfall sunshineHours temperatureMin temperatureMax createdAt');
    res.json({ plans });
  } catch (error) {
    next(error);
  }
});

app.post('/api/plans', requireUser, async (req, res, next) => {
  try {
    const input = {
      crop: req.body.crop,
      area: Number(req.body.area),
      ph: Number(req.body.ph),
      nitrogen: req.body.nitrogen,
      phosphorus: req.body.phosphorus,
      potassium: req.body.potassium,
      rainfall: Number(req.body.rainfall),
    };
    for (const field of ['sunshineHours', 'temperatureMin', 'temperatureMax']) {
      if (req.body[field] !== undefined) input[field] = req.body[field];
    }

    if (!validPlanInput(input)) {
      return res.status(400).json({ error: 'Check the crop, field size, soil test, pH, and rainfall values.' });
    }

    const plan = await Plan.create({ ...input, userId: req.session.userId });
    res.status(201).json({ plan });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/plans/:id', requireUser, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid plan id.' });
    }
    const plan = await Plan.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
    if (!plan) return res.status(404).json({ error: 'Saved plan not found.' });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

const publicFiles = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/auth.html': 'auth.html',
  '/styles.css': 'styles.css',
  '/language.js': 'language.js',
  '/app.js': 'app.js',
  '/auth.js': 'auth.js',
};

for (const [route, filename] of Object.entries(publicFiles)) {
  app.get(route, (_req, res) => res.sendFile(path.join(projectDirectory, filename)));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'The request could not be completed. Please try again.' });
});

app.listen(port, () => {
  console.log(`agriSense is running at http://localhost:${port}`);
});
