const cropTargets = {
  maize: { label: 'maize', nitrogen: 150, phosphorus: 60, potassium: 60 },
  wheat: { label: 'wheat', nitrogen: 100, phosphorus: 45, potassium: 40 },
  rice: { label: 'rice', nitrogen: 100, phosphorus: 40, potassium: 40 },
  tomato: { label: 'tomato', nitrogen: 120, phosphorus: 80, potassium: 100 },
  cotton: { label: 'cotton', nitrogen: 100, phosphorus: 50, potassium: 50 },
};

const soilFactors = { low: 1, medium: 0.7, high: 0.4 };
const fertilizerProducts = {
  dap: { name: 'DAP', formula: '18-46-0', phosphorus: 0.46, nitrogen: 0.18 },
  urea: { name: 'Urea', formula: '46-0-0', nitrogen: 0.46 },
  mop: { name: 'MOP (potash)', formula: '0-0-60', potassium: 0.6 },
};

const form = document.querySelector('#planner-form');
const resultsContext = document.querySelector('#results-context');
const nutrientSummary = document.querySelector('#nutrient-summary');
const productList = document.querySelector('#product-list');
const weatherMessage = document.querySelector('#weather-message');
const rainfallInput = document.querySelector('#rainfall');
const sunshineInput = document.querySelector('#sunshine-hours');
const temperatureMinInput = document.querySelector('#temperature-min');
const temperatureMaxInput = document.querySelector('#temperature-max');
const sunshineValue = document.querySelector('#sunshine-value');
const temperatureValue = document.querySelector('#temperature-value');
const weatherButton = document.querySelector('#weather-button');
const manualWeatherButton = document.querySelector('#manual-weather-button');
const weatherStatus = document.querySelector('#weather-status');
const manualLocation = document.querySelector('.manual-location');
const latitudeInput = document.querySelector('#latitude');
const longitudeInput = document.querySelector('#longitude');
const savePlanButton = document.querySelector('#save-plan-button');
const planStatus = document.querySelector('#plan-status');
const savedPlans = document.querySelector('#saved-plans');
const savedPlanList = document.querySelector('#saved-plan-list');
const signInLink = document.querySelector('#sign-in-link');
const registerLink = document.querySelector('#register-link');
const accountLabel = document.querySelector('#account-label');
const logoutButton = document.querySelector('#logout-button');
const language = window.AgriSenseLanguage;

let currentUser = null;
let currentPlan = null;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const crop = cropTargets[formData.get('crop')];
  const area = Number(formData.get('area'));
  const ph = Number(formData.get('ph'));
  const rainfall = Number(formData.get('rainfall'));
  const sunshineHours = formData.get('sunshineHours');
  const temperatureMin = formData.get('temperatureMin');
  const temperatureMax = formData.get('temperatureMax');

  if (!crop || !Number.isFinite(area) || !Number.isFinite(ph) || !Number.isFinite(rainfall)) {
    return;
  }

  const hasWeatherMetrics = sunshineHours !== '' && temperatureMin !== '' && temperatureMax !== ''
    && Number.isFinite(Number(sunshineHours))
    && Number.isFinite(Number(temperatureMin))
    && Number.isFinite(Number(temperatureMax));
  const weatherMetrics = hasWeatherMetrics
    ? {
      sunshineHours: Number(sunshineHours),
      temperatureMin: Number(temperatureMin),
      temperatureMax: Number(temperatureMax),
    }
    : null;

  currentPlan = {
    crop: formData.get('crop'),
    area,
    ph,
    nitrogen: formData.get('nitrogen'),
    phosphorus: formData.get('phosphorus'),
    potassium: formData.get('potassium'),
    rainfall,
    ...(weatherMetrics ?? {}),
  };

  const perAcre = {
    nitrogen: crop.nitrogen * soilFactors[formData.get('nitrogen')],
    phosphorus: crop.phosphorus * soilFactors[formData.get('phosphorus')],
    potassium: crop.potassium * soilFactors[formData.get('potassium')],
  };

  renderNutrients(perAcre);
  renderProducts(perAcre, area);
  renderWeather(rainfall, ph);
  renderWeatherMetrics(weatherMetrics);
  resultsContext.textContent = `${language.translate(crop.label).toLocaleUpperCase()} · ${formatNumber(area)} ${language.translate('acres').toLocaleUpperCase()}`;
});

savePlanButton.addEventListener('click', () => {
  if (!currentUser) {
    window.location.assign('auth.html?mode=login');
    return;
  }
  saveCurrentPlan();
});

logoutButton.addEventListener('click', signOut);
weatherButton.addEventListener('click', requestLocationForecast);
manualWeatherButton.addEventListener('click', requestManualForecast);

function requestLocationForecast() {
  if (!navigator.geolocation) {
    manualLocation.open = true;
    setWeatherStatus('weatherLocationUnsupported');
    return;
  }

  weatherButton.disabled = true;
  setWeatherStatus('fetchingWeather');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => loadWeatherForecast(coords.latitude, coords.longitude),
    (error) => {
      weatherButton.disabled = false;
      manualLocation.open = true;
      setWeatherStatus(error.code === 1
        ? 'weatherLocationDenied'
        : 'weatherLocationUnavailable');
    },
    { enableHighAccuracy: false, maximumAge: 15 * 60 * 1000, timeout: 10000 },
  );
}

function requestManualForecast() {
  const latitude = latitudeInput.value.trim();
  const longitude = longitudeInput.value.trim();
  if (!latitude || !longitude || !latitudeInput.checkValidity() || !longitudeInput.checkValidity()) {
    setWeatherStatus('weatherCoordinatesInvalid');
    if (!latitude) latitudeInput.focus();
    else if (!longitude) longitudeInput.focus();
    else if (!latitudeInput.checkValidity()) latitudeInput.reportValidity();
    else longitudeInput.reportValidity();
    return;
  }
  loadWeatherForecast(Number(latitude), Number(longitude));
}

async function loadWeatherForecast(latitude, longitude) {
  weatherButton.disabled = true;
  manualWeatherButton.disabled = true;
  setWeatherStatus('fetchingWeather');

  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: 'precipitation_sum,sunshine_duration,temperature_2m_min,temperature_2m_max',
      forecast_days: '7',
      timezone: 'auto',
    });

    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Forecast request failed.');
    const forecast = await response.json();
    const rainfallValues = forecast.daily?.precipitation_sum;
    const sunshineValues = forecast.daily?.sunshine_duration;
    const minimumTemperatures = forecast.daily?.temperature_2m_min;
    const maximumTemperatures = forecast.daily?.temperature_2m_max;
    if (![rainfallValues, sunshineValues, minimumTemperatures, maximumTemperatures]
      .every((values) => Array.isArray(values) && values.length === 7)) {
      throw new Error('Forecast response did not include all seven-day weather values.');
    }

    const totalRainfall = rainfallValues.reduce(
      (total, value) => total + (Number.isFinite(value) ? value : 0),
      0,
    );
    const roundedRainfall = Math.round(totalRainfall * 10) / 10;
    if (roundedRainfall > Number(rainfallInput.max)) {
      setWeatherStatus('weatherAboveLimit');
      return;
    }

    const availableSunshine = sunshineValues.filter(Number.isFinite);
    const availableMinimums = minimumTemperatures.filter(Number.isFinite);
    const availableMaximums = maximumTemperatures.filter(Number.isFinite);
    if (!availableSunshine.length || !availableMinimums.length || !availableMaximums.length) {
      throw new Error('Forecast response did not include sunlight and temperature values.');
    }
    const sunshineHours = Math.round(availableSunshine.reduce((total, seconds) => total + seconds, 0) / 360) / 10;
    const temperatureMin = Math.round(Math.min(...availableMinimums) * 10) / 10;
    const temperatureMax = Math.round(Math.max(...availableMaximums) * 10) / 10;

    rainfallInput.value = String(roundedRainfall);
    sunshineInput.value = String(sunshineHours);
    temperatureMinInput.value = String(temperatureMin);
    temperatureMaxInput.value = String(temperatureMax);
    form.requestSubmit();
    setWeatherStatus('weatherSuccess', { rain: formatNumber(roundedRainfall) }, roundedRainfall);
  } catch {
    setWeatherStatus('weatherUnavailable');
  } finally {
    weatherButton.disabled = false;
    manualWeatherButton.disabled = false;
  }
}

function setWeatherStatus(key, values = {}, rawRainfall) {
  weatherStatus.dataset.translationKey = key;
  if (Number.isFinite(rawRainfall)) weatherStatus.dataset.rainfall = String(rawRainfall);
  else delete weatherStatus.dataset.rainfall;
  weatherStatus.textContent = language.translate(key, values);
}

async function loadCurrentUser() {
  try {
    const response = await fetch('/api/auth/me');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load your account.');
    currentUser = result.user;
    updateAccountControls();
    if (currentUser) await loadSavedPlans();
  } catch {
    setPlanStatus('databaseOffline');
  }
}

function updateAccountControls() {
  const signedIn = Boolean(currentUser);
  signInLink.hidden = signedIn;
  registerLink.hidden = signedIn;
  accountLabel.hidden = !signedIn;
  logoutButton.hidden = !signedIn;
  savedPlans.hidden = !signedIn;
  savePlanButton.textContent = language.translate(signedIn ? 'savePlan' : 'signInToSave');
  accountLabel.textContent = signedIn ? currentUser.email : '';
}

async function saveCurrentPlan() {
  if (!currentPlan) return;

  savePlanButton.disabled = true;
  setPlanStatus('savingPlan');
  try {
    const response = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentPlan),
    });
    const result = await response.json();
    if (!response.ok) {
      setPlanStatus(null, language.translateServerError(result.error, 'saveFailed'));
      return;
    }
    setPlanStatus('planSaved');
    await loadSavedPlans();
  } catch (error) {
    setPlanStatus('saveFailed');
  } finally {
    savePlanButton.disabled = false;
  }
}

async function loadSavedPlans() {
  const response = await fetch('/api/plans');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load saved plans.');

  if (result.plans.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-plan-empty';
    empty.textContent = language.translate('plansEmpty');
    savedPlanList.replaceChildren(empty);
    return;
  }

  savedPlanList.replaceChildren(...result.plans.map((plan) => {
    const row = document.createElement('div');
    row.className = 'saved-plan-row';
    const loadButton = document.createElement('button');
    loadButton.className = 'saved-plan-load';
    loadButton.type = 'button';
    const crop = cropTargets[plan.crop];
    loadButton.textContent = language.translate(plan.area === 1 ? 'acreForCrop' : 'acresForCrop', {
      crop: language.translate(crop.label),
      area: formatNumber(plan.area),
    });
    loadButton.addEventListener('click', () => restorePlan(plan));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'saved-plan-delete';
    deleteButton.type = 'button';
    deleteButton.textContent = language.translate('remove');
    deleteButton.setAttribute('aria-label', language.translate('removePlan', { crop: language.translate(crop.label) }));
    deleteButton.title = language.translate('deletePlanTitle');
    deleteButton.addEventListener('click', () => deletePlan(plan._id));

    row.append(loadButton, deleteButton);
    return row;
  }));
}

function restorePlan(plan) {
  sunshineInput.value = '';
  temperatureMinInput.value = '';
  temperatureMaxInput.value = '';
  for (const [field, value] of Object.entries(plan)) {
    const input = form.elements.namedItem(field);
    if (input) input.value = value;
  }
  form.requestSubmit();
  setPlanStatus('planLoaded');
}

async function deletePlan(planId) {
  setPlanStatus('removingPlan');
  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) {
      setPlanStatus(null, language.translateServerError(result.error, 'removeFailed'));
      return;
    }
    setPlanStatus('planRemoved');
    await loadSavedPlans();
  } catch (error) {
    setPlanStatus('removeFailed');
  }
}

async function signOut() {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not sign out.');
    currentUser = null;
    savedPlanList.replaceChildren();
    setPlanStatus('signedOut');
    updateAccountControls();
  } catch (error) {
    setPlanStatus('signOutFailed');
  } finally {
    logoutButton.disabled = false;
  }
}

function setPlanStatus(key, fallbackText) {
  if (key) {
    planStatus.dataset.translationKey = key;
    delete planStatus.dataset.translationText;
    planStatus.textContent = language.translate(key);
  } else {
    delete planStatus.dataset.translationKey;
    planStatus.dataset.translationText = fallbackText;
    planStatus.textContent = fallbackText;
  }
}

function renderNutrients(nutrients) {
  const values = [
    ['N', nutrients.nitrogen],
    ['P₂O₅', nutrients.phosphorus],
    ['K₂O', nutrients.potassium],
  ];

  nutrientSummary.replaceChildren(...values.map(([label, amount]) => {
    const item = document.createElement('div');
    item.className = 'nutrient-value';

    const value = document.createElement('strong');
    value.textContent = formatNumber(amount);
    const name = document.createElement('span');
    name.textContent = label;

    item.append(value, name);
    return item;
  }));
}

function renderProducts(nutrients, area) {
  const dapPerAcre = nutrients.phosphorus / fertilizerProducts.dap.phosphorus;
  const ureaPerAcre = Math.max(
    0,
    (nutrients.nitrogen - dapPerAcre * fertilizerProducts.dap.nitrogen) / fertilizerProducts.urea.nitrogen,
  );
  const mopPerAcre = nutrients.potassium / fertilizerProducts.mop.potassium;

  const products = [
    { ...fertilizerProducts.dap, rate: dapPerAcre },
    { ...fertilizerProducts.urea, rate: ureaPerAcre },
    { ...fertilizerProducts.mop, rate: mopPerAcre },
  ].filter((product) => product.rate > 0.05);

  if (products.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'no-product';
    empty.textContent = language.translate('noFertilizer');
    productList.replaceChildren(empty);
    return;
  }

  productList.replaceChildren(...products.map((product) => {
    const row = document.createElement('div');
    row.className = 'product-row';

    const info = document.createElement('div');
    info.className = 'product-info';
    const marker = document.createElement('span');
    marker.className = 'product-marker';
    marker.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'product-name';
    name.textContent = product.name === 'Urea'
      ? language.translate('productUrea')
      : product.name === 'MOP (potash)'
        ? language.translate('productMop')
        : product.name;
    const formula = document.createElement('span');
    formula.className = 'product-formula';
    formula.textContent = product.formula;
    text.append(name, formula);
    info.append(marker, text);

    const amount = document.createElement('div');
    amount.className = 'product-amount';
    amount.append(document.createTextNode(formatNumber(product.rate * area)));
    const unit = document.createElement('span');
    unit.textContent = language.translate('pounds');
    amount.append(unit);

    row.append(info, amount);
    return row;
  }));
}

function renderWeather(rainfall, ph) {
  const messageKey = rainfall >= 50
    ? 'rainHeavy'
    : rainfall >= 25
      ? 'rainModerate'
      : rainfall < 5
        ? 'rainLow'
        : 'rainNormal';
  let message = language.translate(messageKey, { rain: formatNumber(rainfall) });
  if (ph < 5.5 || ph > 7.5) {
    message += language.translate('phAdvisory', { ph: formatNumber(ph) });
  }

  weatherMessage.textContent = message;
}

function renderWeatherMetrics(metrics) {
  if (!metrics) {
    sunshineValue.textContent = '—';
    temperatureValue.textContent = '—';
    return;
  }

  sunshineValue.textContent = `${formatNumber(metrics.sunshineHours)} ${language.translate('hours')}`;
  temperatureValue.textContent = `${formatNumber(metrics.temperatureMin)}–${formatNumber(metrics.temperatureMax)} °C`;
}

function formatNumber(value) {
  return language.formatNumber(value);
}

form.requestSubmit();
loadCurrentUser();

document.addEventListener('languagechange', () => {
  updateAccountControls();
  if (currentPlan) form.requestSubmit();
  if (planStatus.dataset.translationKey) {
    setPlanStatus(planStatus.dataset.translationKey);
  } else if (planStatus.dataset.translationText) {
    planStatus.textContent = planStatus.dataset.translationText;
  }
  if (currentUser) loadSavedPlans().catch(() => setPlanStatus('databasePlanError'));
  if (weatherStatus.dataset.translationKey) {
    const values = weatherStatus.dataset.rainfall
      ? { rain: language.formatNumber(Number(weatherStatus.dataset.rainfall)) }
      : {};
    setWeatherStatus(weatherStatus.dataset.translationKey, values, Number(weatherStatus.dataset.rainfall));
  }
});
