// Reconstruct a modern WGS84 point to its paleo-position with the GPlates Web Service (spec 11.3).
// Usage: node atlas/tools/paleo.mjs <lon> <lat> <age_ma> [MODEL ...]
// Models (coverage): MULLER2019 (0-250 Ma), MERDITH2021 (0-1000 Ma), PALEOMAP (0-750 Ma), SETON2012 (0-200 Ma).
// Cite in sources as class "dataset": GPlates Web Service, EarthByte Group, with the model's paper.
const [lon, lat, age, ...models] = process.argv.slice(2);
const list = models.length ? models : ['MULLER2019', 'MERDITH2021', 'PALEOMAP'];
for (const model of list) {
  const url = `https://gws.gplates.org/reconstruct/reconstruct_points/?points=${lon},${lat}&time=${age}&model=${model}`;
  try {
    const j = await (await fetch(url)).json();
    const c = j.coordinates?.[0];
    console.log(`${model.padEnd(12)} age ${age} Ma -> ${c ? `lat ${c[1].toFixed(2)}, lon ${c[0].toFixed(2)}` : JSON.stringify(j)}   ${url}`);
  } catch (e) { console.log(`${model}: error ${e.message}`); }
}
