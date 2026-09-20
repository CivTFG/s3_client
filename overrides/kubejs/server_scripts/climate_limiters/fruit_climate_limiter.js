// Blocks players from planting a fruit tree sapling or berry bush somewhere that plant
// could never naturally grow, checked against the average temperature/rainfall range
// TFC's (and Firmalife's) own worldgen uses to decide where each one's wild copies spawn.
// Sibling project to s3_tree_limiter (wood trees) and s3_crop_limiter (farmland crops),
// same approach applied to fruit trees/bushes instead.
//
// Unlike wood-tree saplings and crops, not every fruit plant has full temperature+rainfall
// data available: several berry bushes (bunchberry, cloudberry, cranberry, gooseberry,
// snowberry, strawberry, wintergreen berry) and some Firmalife/TFG-Core plants (nightshade
// bush, pineapple bush, and the acai/coconut/date/oil palm trees) spawn purely via a
// "would_survive" substrate check in worldgen, with no "tfc:climate" placement entry at
// all - no ambient rainfall bound exists for them anywhere. They do still have a
// min_temperature/max_temperature in their climate_ranges file though (that's ambient
// climate data, not hydration), so those are included below with rain checking skipped
// entirely (`minRain`/`maxRain` omitted) rather than left out - better to catch an
// obviously wrong temperature than to check nothing at all. Their min_hydration/
// max_hydration is still not used (farmland/water-proximity moisture, not climate, same
// reasoning as s3_crop_limiter).
//
// Grapes (Firmalife) need their own separate handler below: GrapeSeedItem is a plain
// Item, not a BlockItem - its useOn() writes the grown state straight in with
// Level.setBlockAndUpdate, never going through BlockItem.place()/ForgeEventFactory, so
// BlockEvents.placed never fires for it (confirmed by decompiling GrapeSeedItem - same
// bypass category as the Schematic Cannon/Mechanical Harvester in the other two scripts'
// READMEs). Unlike those two, this one CAN still be caught: the vanilla "use item on
// block" sequence fires Forge's PlayerInteractEvent.RightClickBlock (KubeJS
// BlockEvents.rightClicked) before calling the item's own useOn(), so cancelling there
// stops GrapeSeedItem.useOn from ever running. Tomato is not part of this - despite also
// needing a support structure (it's a TFC ClimbingCropBlock), its seed is a normal TFC
// crop seed placed the standard way, so it's already covered as "tomato" in
// s3_crop_limiter, no special handling needed.
//
// Same placement-only caveat as the other two scripts: TFC's live growth tick checks
// climate using Climate.getTemperature (the current, Y-dependent value - see
// s3_tree_limiter's notes on the "bedrock trick"), not the average value used here.

// Wrapped in an IIFE: this pack's server_scripts share one global scope, and the sibling
// crop/tree climate limiters declare the same top-level const names (ENABLED,
// TEMP_TOLERANCE, RAIN_TOLERANCE) - without this wrapper, loading all three throws
// "redeclaration of const" and only the first-loaded one actually works.
(function() {

const ENABLED = true;

// Widen every plant's natural range by this much before rejecting a placement. 0 = exactly
// TFC's/Firmalife's own worldgen range.
const TEMP_TOLERANCE = 0;
const RAIN_TOLERANCE = 0;

const FRUIT_CLIMATE = {
	// TFC fruit trees (planted as tfc:plant/<name>_sapling)
	"tfc:plant/banana_sapling":     { minTemp: 17, maxTemp: 35, minRain: 280, maxRain: 500 },
	"tfc:plant/cherry_sapling":     { minTemp: 5,  maxTemp: 25, minRain: 100, maxRain: 350 },
	"tfc:plant/green_apple_sapling":{ minTemp: 1,  maxTemp: 25, minRain: 110, maxRain: 280 },
	"tfc:plant/lemon_sapling":      { minTemp: 10, maxTemp: 30, minRain: 180, maxRain: 470 },
	"tfc:plant/olive_sapling":      { minTemp: 5,  maxTemp: 30, minRain: 150, maxRain: 500 },
	"tfc:plant/orange_sapling":     { minTemp: 15, maxTemp: 36, minRain: 250, maxRain: 500 },
	"tfc:plant/peach_sapling":      { minTemp: 4,  maxTemp: 27, minRain: 60,  maxRain: 230 },
	"tfc:plant/plum_sapling":       { minTemp: 15, maxTemp: 31, minRain: 250, maxRain: 400 },
	"tfc:plant/red_apple_sapling":  { minTemp: 1,  maxTemp: 25, minRain: 100, maxRain: 280 },

	// TFC berry bushes (planted as tfc:plant/<name>_bush) - only the ones with worldgen
	// climate data, see the file header for which bushes are excluded and why.
	"tfc:plant/blackberry_bush":    { minTemp: 7,  maxTemp: 24, minRain: 200, maxRain: 500 },
	"tfc:plant/blueberry_bush":     { minTemp: 7,  maxTemp: 29, minRain: 100, maxRain: 400 },
	"tfc:plant/elderberry_bush":    { minTemp: 10, maxTemp: 33, minRain: 100, maxRain: 400 },
	"tfc:plant/raspberry_bush":     { minTemp: 5,  maxTemp: 25, minRain: 200, maxRain: 500 },

	// Firmalife (planted as firmalife:plant/<name>_sapling)
	"firmalife:plant/cocoa_sapling":{ minTemp: 20, maxTemp: 35, minRain: 220, maxRain: 400 },
	"firmalife:plant/fig_sapling":  { minTemp: 20, maxTemp: 35, minRain: 125, maxRain: 215 },

	// Temperature-only below this point - no worldgen rainfall data exists for these, see
	// the file header. minRain/maxRain intentionally omitted; the check skips rain for them.

	// TFC berry bushes without worldgen climate data (still tfc:plant/<name>_bush)
	"tfc:plant/bunchberry_bush":       { minTemp: 15, maxTemp: 35 },
	"tfc:plant/cloudberry_bush":       { minTemp: -2, maxTemp: 17 },
	"tfc:plant/cranberry_bush":        { minTemp: -5, maxTemp: 17 }, // grows in water anyway, substrate handles "wet enough"
	"tfc:plant/gooseberry_bush":       { minTemp: 5,  maxTemp: 27 },
	"tfc:plant/snowberry_bush":        { minTemp: -7, maxTemp: 18 },
	"tfc:plant/strawberry_bush":       { minTemp: 5,  maxTemp: 28 },
	"tfc:plant/wintergreen_berry_bush":{ minTemp: -6, maxTemp: 17 },

	// Firmalife, no worldgen climate data
	"firmalife:plant/nightshade_bush": { minTemp: 7,  maxTemp: 24 },
	"firmalife:plant/pineapple_bush":  { minTemp: 20, maxTemp: 32 },

	// TFG-Core palm trees (planted as tfg:palm_tree/<name>_sapling), no worldgen spawn at all
	"tfg:palm_tree/acai_sapling":      { minTemp: 24, maxTemp: 70 },
	"tfg:palm_tree/coconut_sapling":   { minTemp: 15, maxTemp: 45 },
	"tfg:palm_tree/date_sapling":      { minTemp: 20, maxTemp: 50 },
	"tfg:palm_tree/oil_palm_sapling":  { minTemp: 19, maxTemp: 62 },
};

// Firmalife grapes - both colors share one range (data/firmalife/tfc/climate_ranges/
// plant/grapes.json ships 0-50C, which is basically no constraint at all, so this is
// replaced with real viticulture data instead). See the file header for why grapes need
// their own event entirely.
//
// Temperature is real-world mean annual temperature for wine-growing regions, unscaled -
// TFC's own temperature ranges elsewhere already match real-world figures directly (e.g.
// Oak -3 to 15.3C, Kapok 17.1-38C both line up with reality with no conversion needed), so
// no scaling applied here either: 9C is roughly the Mosel (one of the coldest viable wine
// regions on Earth), 22C covers up through warm regions used for fortified/dessert wine.
//
// Rainfall needs scaling first: TFC's world generator hard-clamps rainfall to 0-500mm
// everywhere (Mth.clamp in RegionChunkDataGenerator), while real "very wet" regions reach
// 2000mm+ - so TFC's rainfall isn't literal real-world mm, it's compressed by roughly 4x.
// Checked against existing TFC data to confirm: Oak's 210-320mm x4 = 840-1280mm (real
// temperate forest wants ~750-1500mm - matches); Kapok's 320-500mm x4 = 1280-2000mm+ (real
// rainforest wants ~1500-2500mm - matches). Applying the same x4 to real viticulture
// rainfall (roughly 300-500mm real-world, dry-farm minimum to quality-wine ceiling) gives
// 75-125mm on TFC's scale.
const GRAPE_SEED_ITEMS = ["firmalife:seeds/red_grape", "firmalife:seeds/white_grape"];
const GRAPE_CLIMATE = { minTemp: 9, maxTemp: 22, minRain: 75, maxRain: 125 };

// Returns a rejection message, or null if the climate at `pos` satisfies `range`.
function checkClimate(level, pos, range) {
	const hasRainData = range.minRain !== undefined;

	const temp = TFC.climate.getAverageTemperature(level, pos);
	const rain = hasRainData ? TFC.climate.getAverageRainfall(level, pos) : null;

	const tempOk = temp >= range.minTemp - TEMP_TOLERANCE && temp <= range.maxTemp + TEMP_TOLERANCE;
	const rainOk = !hasRainData || (rain >= range.minRain - RAIN_TOLERANCE && rain <= range.maxRain + RAIN_TOLERANCE);
	if (tempOk && rainOk) return null;

	const reasons = [];
	if (temp < range.minTemp - TEMP_TOLERANCE) reasons.push("too cold");
	if (temp > range.maxTemp + TEMP_TOLERANCE) reasons.push("too hot");
	if (hasRainData && rain < range.minRain - RAIN_TOLERANCE) reasons.push("too dry");
	if (hasRainData && rain > range.maxRain + RAIN_TOLERANCE) reasons.push("too wet");
	return `This plant can't grow in this climate (${reasons.join(", ")})`;
}

BlockEvents.placed(event => {
	if (!ENABLED) return;

	const { block, level, player } = event;
	if (!player) return;

	const range = FRUIT_CLIMATE[block.id];
	if (!range) return; // not one of the plants covered above

	const rejection = checkClimate(level, block.pos, range);
	if (rejection) {
		event.cancel();
		player.tell(Text.of(rejection).red());
	}
});

// Grapes only: cancelling here stops GrapeSeedItem.useOn from ever running, before it can
// write the grown state in directly (see the file header).
BlockEvents.rightClicked(event => {
	if (!ENABLED) return;

	const { block, level, player, item } = event;
	if (!player || !GRAPE_SEED_ITEMS.includes(item.id)) return;

	const rejection = checkClimate(level, block.pos, GRAPE_CLIMATE);
	if (rejection) {
		event.cancel();
		player.tell(Text.of(rejection).red());
	}
});

})();
