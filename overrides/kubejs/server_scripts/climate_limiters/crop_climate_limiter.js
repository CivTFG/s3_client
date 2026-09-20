// Blocks players from planting TFC crop seeds somewhere that crop could never naturally
// grow. Originally this checked the exact stock average temperature/rainfall range from
// TFC's own worldgen (data/tfc/worldgen/placed_feature/plant/wild_crop/<crop>_patch.json,
// the "tfc:climate" placement entry) - the ranges below are now a deliberately narrowed
// variant of those stock ranges instead (see s2_mods/s3_balance_anleitung.md section 2),
// kept in sync with matching kubejs/data overrides of the same worldgen files, so wild
// crop spawn locations and "can a player plant this here" agree with each other again.
//
// The narrowing is graduated, not a flat percentage: for each axis (temperature,
// rainfall) find the global centre and radius across all 23 crops' stock ranges, then for
// each crop compare its own centre to that global centre. The bound facing the crop's
// natural extreme (e.g. Garlic's cold end, Papyrus's hot end) is left exactly as the
// stock value; only the bound facing the global centre moves inward, by up to 33% of the
// original span - scaled down the closer that crop's own centre already sits to the
// global centre, so crops near the middle of the whole spectrum (Rye, Beet, Soybean,
// Green Bean) barely move while the most extreme crops (Garlic, Papyrus, Maize,
// Sugarcane, Cabbage) get pulled in noticeably. Every new bound is rounded to the nearest
// 5. Re-derive by re-running this same calculation if the stock ranges ever change.
//
// Deliberately NOT using TFC's farmland hydration (min_hydration/max_hydration in
// data/tfc/tfc/climate_ranges/crop/<crop>.json) - that's a farmland-moisture stat driven
// by nearby water/irrigation, unrelated to ambient climate, and it's something a player
// can freely change after planting anyway. This script only judges the *site's* natural
// climate, same philosophy as the tree limiter.
//
// Same caveat as the tree limiter applies here too: this only gates *placement*. TFC's
// live crop growth tick (CropHelpers.growthTickStep) checks climate on every tick using
// Climate.getTemperature (the current, Y-dependent value - the one that reads a flat 15C
// near y=-64, see the tree limiter's notes on the "bedrock trick"), not the average value
// this script uses. A crop planted here can still fail to grow later if dragged badly out
// of season, or (in vanilla TFC, independent of this script) be cheesed near bedrock.

// Wrapped in an IIFE: this pack's server_scripts share one global scope, and the sibling
// tree/fruit climate limiters declare the same top-level const names (ENABLED,
// TEMP_TOLERANCE, RAIN_TOLERANCE) - without this wrapper, loading all three throws
// "redeclaration of const" and only the first-loaded one actually works.
(function() {

const ENABLED = true;

// Widen every crop's natural range by this much before rejecting a placement. 0 = exactly
// TFC's own worldgen range.
const TEMP_TOLERANCE = 0;
const RAIN_TOLERANCE = 0;

const CROP_CLIMATE = {
	barley:             { minTemp: -8,  maxTemp: 25, minRain: 70,  maxRain: 280 },
	beet:               { minTemp: -5,  maxTemp: 20, minRain: 70,  maxRain: 265 },
	cabbage:            { minTemp: -10, maxTemp: 25, minRain: 60,  maxRain: 245 },
	carrot:             { minTemp: 5,   maxTemp: 30, minRain: 100, maxRain: 385 },
	garlic:             { minTemp: -20, maxTemp: 15, minRain: 60,  maxRain: 275 },
	green_bean:         { minTemp: 5,   maxTemp: 35, minRain: 150, maxRain: 410 },
	jute:               { minTemp: 10,  maxTemp: 37, minRain: 100, maxRain: 400 },
	maize:              { minTemp: 20,  maxTemp: 40, minRain: 335, maxRain: 500 },
	melon:              { minTemp: 10,  maxTemp: 37, minRain: 230, maxRain: 500 },
	oat:                { minTemp: 10,  maxTemp: 40, minRain: 140, maxRain: 395 },
	onion:              { minTemp: 0,   maxTemp: 30, minRain: 100, maxRain: 375 },
	papyrus:            { minTemp: 25,  maxTemp: 37, minRain: 345, maxRain: 500 },
	potato:             { minTemp: 0,   maxTemp: 37, minRain: 210, maxRain: 410 },
	pumpkin:            { minTemp: 0,   maxTemp: 30, minRain: 120, maxRain: 380 },
	red_bell_pepper:    { minTemp: 20,  maxTemp: 30, minRain: 195, maxRain: 400 },
	rice:               { minTemp: 15,  maxTemp: 30, minRain: 110, maxRain: 500 },
	rye:                { minTemp: -11, maxTemp: 30, minRain: 100, maxRain: 330 },
	soybean:            { minTemp: 10,  maxTemp: 30, minRain: 160, maxRain: 410 },
	squash:             { minTemp: 10,  maxTemp: 33, minRain: 90,  maxRain: 370 },
	sugarcane:          { minTemp: 15,  maxTemp: 38, minRain: 185, maxRain: 500 },
	tomato:             { minTemp: 5,   maxTemp: 36, minRain: 120, maxRain: 380 },
	wheat:              { minTemp: 0,   maxTemp: 35, minRain: 100, maxRain: 385 },
	yellow_bell_pepper: { minTemp: 20,  maxTemp: 30, minRain: 195, maxRain: 400 },
};

const CROP_PREFIX = "tfc:crop/";

BlockEvents.placed(event => {
	if (!ENABLED) return;

	const { block, level, player } = event;
	if (!player || !block.id.startsWith(CROP_PREFIX)) return;

	const crop = block.id.substring(CROP_PREFIX.length);
	const range = CROP_CLIMATE[crop];
	if (!range) return; // not one of the crops covered above

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

		player.tell(Text.of(`This crop can't grow in this climate (${reasons.join(", ")})`).red());
	}
});

})();
