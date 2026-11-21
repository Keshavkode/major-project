# agriSense fertilizer planner

A fertilizer-planning app for exploring crop, soil-test nutrient ratings, field size, soil pH, and a seven-day rain forecast. A Node.js API uses a local MongoDB database to manage accounts, sessions, and saved field plans.

The planner can retrieve a seven-day forecast from the Open-Meteo API, including total precipitation, sunshine duration, and the forecast temperature range. Use the location button to grant browser location access, or enter latitude and longitude manually. Coordinates are sent to Open-Meteo to request the forecast and are not stored by agriSense. Rainfall, sunshine hours, and temperature range are included when a plan is saved.

## Requirements

- Node.js 20 or later
- MongoDB Community Server running locally

## Start the app

From this directory, install dependencies and create your environment file:

```powershell
npm install
Copy-Item .env.example .env
```

In `.env`, replace `SESSION_SECRET` with a random value of at least 32 characters. For example, generate one with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The default `MONGODB_URI` connects to `mongodb://127.0.0.1:27017/agrisense`. Start MongoDB, then run:

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). Do not open the HTML files directly; account and database features require the server.

## Languages

Use the language selector in the header to switch the planner and account screens between English, Hindi, Bengali, Tamil, and Telugu. Your selection is saved in this browser.

## Accounts and saved plans

- Register and sign in with an email and password. Passwords are hashed with bcrypt; the app stores a server-side session in MongoDB using an HTTP-only, same-site cookie.
- Signed-in users can save, reload, and remove field plans. The planner lists the 50 most recently saved plans for the signed-in user.
- MongoDB creates the `users`, `plans`, and `sessions` collections as the app uses them.
- `.env` is ignored by Git. Never commit your session secret or database credentials.

## How the estimate works

- Crop-specific example nutrient targets are adjusted by the selected soil-test rating (low: 100%, medium: 70%, high: 40%).
- The adjusted phosphorus target is expressed as P₂O₅ and potassium as K₂O. DAP (18-46-0) supplies the phosphorus target first; its nitrogen contribution is subtracted before estimating urea (46-0-0). MOP (0-0-60) supplies the potassium target.
- The displayed product quantities are rounded to one decimal place and scaled to the entered field area.
- Forecast rain and soil pH add timing or follow-up notes; they do not change the nutrient calculation.

## Recommendation limitations

This is an educational prototype, not a validated agronomic prescription. Crop targets, soil-rating adjustments, and product calculations are generalized examples in US customary units. Actual nutrient needs depend on region, yield goals, soil-test methods, crop stage, previous applications, and local regulations. Confirm recommendations with a recent calibrated soil test, local extension or an agronomist, and product labels before applying fertilizer.
