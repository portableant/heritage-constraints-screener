const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export async function geocodeQuery(rawQuery) {
  const query = rawQuery.trim();
  if (!query) throw new Error('Enter a UK postcode or place name.');

  if (UK_POSTCODE_REGEX.test(query)) {
    const clean = query.replace(/\s+/g, '');
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
    const data = await res.json();
    if (data.status === 200 && data.result) {
      return turf.point([data.result.longitude, data.result.latitude]);
    }
  }

  const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=gb&limit=1&q=${encodeURIComponent(query)}`;
  const nomRes = await fetch(nomUrl);
  const nomData = await nomRes.json();
  if (Array.isArray(nomData) && nomData.length > 0) {
    return turf.point([parseFloat(nomData[0].lon), parseFloat(nomData[0].lat)]);
  }

  throw new Error(`Location not found: "${query}"`);
}