// Blocks players from planting TFC wood-tree saplings outside that species' natural
// temperature/rainfall range, so a "wrong biome" garden of every tree species side by
// side is no longer possible - only what could actually grow there naturally.
//
// This only gates *placement*. TFC fires no cancellable event when a sapling finishes
// growing into a tree (TFCSaplingBlock reimplements randomTick without going through
// Forge's SaplingGrowTreeEvent), so there is no clean hook to stop growth itself - the
// enforcement point is "you can't plant it here" instead of "it won't grow once planted".
// If a sapling was placed before this script existed, or the climate at that spot changes
// later, it can still grow.
//
// Climate ranges below are copied from TFC's own worldgen data
// (data/tfc/worldgen/configured_feature/tree/<species>_entry.json, the "climate" object),
// i.e. exactly the ranges TFC itself uses to decide where each species generates
// naturally. Temperature is average annual °C, rainfall is average annual mm - the same
// numbers shown by F3 / Jade at a given position.

// Wrapped in an IIFE: this pack's server_scripts share one global scope, and the sibling
// crop/fruit climate limiters declare the same top-level const names (ENABLED,
// TEMP_TOLERANCE, RAIN_TOLERANCE) - without this wrapper, loading all three throws
// "redeclaration of const" and only the first-loaded one actually works.
(function() {

const ENABLED = true;

// Widen a species' natural range by this much before rejecting a placement, in case
// "technically correct" feels too strict at the edges of a climate zone. 0 = exactly
// TFC's own worldgen range.
const TEMP_TOLERANCE = 0;
const RAIN_TOLERANCE = 0;

const TREE_CLIMATE = {
	acacia:      { minTemp: 8,     maxTemp: 38,   minRain: 90,  maxRain: 275 },
	ash:         { minTemp: -1.1,  maxTemp: 13.4, minRain: 60,  maxRain: 240 },
	aspen:       { minTemp: -15.7, maxTemp: -1.1, minRain: 350, maxRain: 500 },
	birch:       { minTemp: -12.1, maxTemp: 6.1,  minRain: 125, maxRain: 310 },
	blackwood:   { minTemp: 8,     maxTemp: 38,   minRain: 35,  maxRain: 180 },
	chestnut:    { minTemp: -3,    maxTemp: 11.6, minRain: 150, maxRain: 340 },
	douglas_fir: { minTemp: -15.7, maxTemp: 6.1,  minRain: 305, maxRain: 500 },
	hickory:     { minTemp: 4.3,   maxTemp: 15.3, minRain: 210, maxRain: 400 },
	kapok:       { minTemp: 17.1,  maxTemp: 38,   minRain: 320, maxRain: 500 },
	mangrove:    { minTemp: 15.7,  maxTemp: 28.2, minRain: 200, maxRain: 500 },
	maple:       { minTemp: -8.4,  maxTemp: 8,    minRain: 240, maxRain: 470 },
	oak:         { minTemp: -3,    maxTemp: 15.3, minRain: 210, maxRain: 320 },
	palm:        { minTemp: 15.3,  maxTemp: 38,   minRain: 200, maxRain: 405 },
	pine:        { minTemp: -8.4,  maxTemp: 9.8,  minRain: 185, maxRain: 320 },
	rosewood:    { minTemp: 9.8,   maxTemp: 38,   minRain: 210, maxRain: 400 },
	sequoia:     { minTemp: 4.3,   maxTemp: 11.6, minRain: 320, maxRain: 500 },
	spruce:      { minTemp: -17.5, maxTemp: -6.6, minRain: 220, maxRain: 470 },
	sycamore:    { minTemp: -6.6,  maxTemp: 13.4, minRain: 330, maxRain: 480 },
	white_cedar: { minTemp: -15.7, maxTemp: 0.7,  minRain: 100, maxRain: 285 },
	willow:      { minTemp: 6.1,   maxTemp: 24.4, minRain: 330, maxRain: 500 },
};

const SAPLING_PREFIX = "tfc:wood/sapling/";

BlockEvents.placed(event => {
	if (!ENABLED) return;

	const { block, level, player } = event;
	if (!player || !block.id.startsWith(SAPLING_PREFIX)) return;

	const species = block.id.substring(SAPLING_PREFIX.length);
	const range = TREE_CLIMATE[species];
	if (!range) return; // not one of the species covered above

	const temp = TFC.climate.getAverageTemperature(level, block.pos);
	const rain = TFC.climate.getAverageRainfall(level, block.pos);

	const tempOk = temp >= range.minTemp - TEMP_TOLERANCE && temp <= range.maxTemp + TEMP_TOLERANCE;
	const rainOk = rain >= range.minRain - RAIN_TOLERANCE && rain <= range.maxRain + RAIN_TOLERANCE;

	if (!tempOk || !rainOk) {
		event.cancel();

		const reasons = [];
		if (temp < range.minTemp - TEMP_TOLERANCE) reasons.push("too cold");
		if (temp > range.maxTemp + TEMP_TOLERANCE) reasons.push("too hot");
		if (rain < range.minRain - RAIN_TOLERANCE) reasons.push("too dry");
		if (rain > range.maxRain + RAIN_TOLERANCE) reasons.push("too wet");

		player.tell(Text.of(`This tree can't grow in this climate (${reasons.join(", ")})`).red());
	}
});

})();
