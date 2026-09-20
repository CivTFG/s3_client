/*
 * item_values_dump.js - the REAL data dump (successor to probe_dump.js).
 *
 * Writes GTCEU material + recipe data to JSON files under
 * kubejs/exported/item_values/ in this instance, as raw material for an
 * item-value/shop concept (see "Civ TFG/item values/CONCEPT_NOTES.md").
 * Read-only - makes no game-state changes.
 *
 * Install:  copy to <TFG instance>/kubejs/server_scripts/item_values_dump.js
 * Run:      /kubejs reload server_scripts (or /reload), then run
 *   /itemvaluesdump   in chat (needs op / cheats enabled)
 * Output:   kubejs/exported/item_values/materials.json (all ~1070 GTCEU
 *   materials) and kubejs/exported/item_values/recipes/<recipe_type>.json
 *   (one file per recipe type, e.g. gtceu_macerator.json) - written
 *   incrementally per type so a failure partway through still leaves
 *   earlier types on disk, and materials.json is written FIRST specifically
 *   so a file-write bug shows up in a second, not after minutes of recipe
 *   iteration (there are ~93 recipe types, some with 10000+ recipes each).
 *
 * v2: added recipe.category (GTRecipeCategory.name via getCategoryMap()'s
 * key, already iterated for the recipe set itself) - needed to tell GTCEU's
 * auto-generated "unification" macerator/extractor/... recipes (any crafted
 * component of a material can be ground back into a fraction of its raw
 * dust) apart from genuine ore-processing recipes, since by id alone they
 * were indistinguishable and were winning the bottom-up cost search as
 * artificially cheap "recycling loops" (see CONCEPT_NOTES.md).
 *
 * v3: /itemvaluesdumpother no longer skips EVERY "gtceu"-mod recipe outright
 * - only ones whose TYPE is already one of GTCEU's own processing-machine
 * types (GTRegistries.RECIPE_TYPES, covered richly by /itemvaluesdump).
 * Found while investigating why not a single GTCEU machine controller/hull
 * item (lv_macerator, mv_extractor, ulv/lv/hv/..._machine_hull, etc.) had
 * ANY recipe in either dump across almost every voltage tier: GTCEU's own
 * datagen also registers plain vanilla-style recipes (e.g.
 * "minecraft:crafting_shaped") for these under the "gtceu:" id namespace -
 * the old blanket "skip mod===gtceu" rule silently dropped those too, on
 * top of them never being a GTRegistries.RECIPE_TYPES entry in the first
 * place. Re-run /itemvaluesdumpother after updating this file to pick up
 * whatever machine-construction recipes actually exist (if this modpack's
 * GTCEU machines turn out to have no data-driven recipe at all even after
 * this fix, that's now a confirmed absence, not a dump-script gap).
 *
 * v4: added a special case for AFC's TreeTapRecipe (afc:tree_tapping - maple/birch syrup,
 * hevea/rubber_fig latex, ...), confirmed via javap decompilation of afc-*.jar not guessed.
 * Like TFC's own Heating/Anvil/Welding/Casting/Bloomery/BlastFurnace classes, it doesn't
 * populate the generic getIngredients()/getResultItem() at all (every entry came out
 * "inputs": [], "resultEmpty": true before this fix) - found while tracing why the ENTIRE
 * GTCEU machine economy (macerator, assembler, every LV+ machine) stayed unreachable even
 * after v3: nearly all of them need insulated cable -> rubber plate -> raw rubber -> latex,
 * and latex's only non-machine (bootstrap) source is tapping a tree via this exact recipe
 * class. getBlockIngredient() (a TFC BlockIngredient, not machine-station of any kind) is
 * the tapped block; getOutput() is a plain FluidStack result (fluid-only output, same
 * pattern as HeatingRecipe/BlastFurnaceRecipe above).
 *
 * v5: Create's ProcessingRecipe base class (Basin/Mixing/Compacting recipes, and every
 * Vintage-Improvements machine built on it - Pressurizing/Vacuumizing/...) stores fluid
 * ingredients/results via its OWN getFluidIngredients()/getFluidResults(), separate from the
 * standard Recipe.getIngredients()/getResultItem() (item-only) - a fluid-only step (e.g. VI's
 * "vulcanized_latex -> raw_rubber_dust") came out as "inputs": [] before this, same class of
 * gap as v4's tree-tapping fix. Found while tracing the SAME GTCEU-machine-economy chain
 * further: even after v4, every LV+ machine still needs insulated cable -> rubber, and the
 * only non-circular (non-machine) route into raw rubber turned out to be exactly this VI
 * pressurizing step. Applied unconditionally via try/catch (confirmed via javap
 * decompilation of create-*.jar/vintageimprovements-*.jar), not gated on exact class name,
 * since several different VI recipe classes share this one Create base class.
 *
 * v6: TFC's Pot recipes (net.dries007.tfc.common.recipes.PotRecipe and its concrete
 * subclasses SimplePotRecipe/JamPotRecipe/SoupPotRecipe, confirmed via javap) don't populate
 * the generic getIngredients()/getResultItem() OR match either of the two existing generic
 * fallbacks (SimpleItemRecipe's getIngredient(), BarrelRecipe's getInputItem()/getInputFluid())
 * - own getItemIngredients() (a LIST, not singular) + getFluidIngredient() instead
 * (confirmed: tfc:pot came out 148/148 empty-result before this). Found while tracing the
 * user's live-verified rubber bootstrap chain ("Latex+Sulfur -> Vulcanized Latex" happens in
 * the TFC Pot, not a GTCEU machine) - without this fix, the ONLY producer of Vulcanized Latex
 * our data saw was an LV+ GTCEU chemical_reactor recipe, wrongly forcing the entire rubber/
 * cable/machine economy behind a machine that (per the real recipe) isn't actually needed for
 * this step. Only SimplePotRecipe has a statically known result (getDisplayFluid() for the
 * output fluid + getOutputProviders()/getEmptyStack() for item outputs, both confirmed via
 * javap) - Jam/SoupPotRecipe compute their result dynamically from the pot's current contents
 * (no static ingredient-list equivalent), so their inputs are now captured but their outputs
 * are deliberately left as before (resultEmpty) rather than guessed.
 *
 * v7: user reported ~35% of all registered items (13835 of 39135 in the S3 item_index.json)
 * never show up anywhere in our recipe data at all - e.g. "Medium Density Fiberboard"
 * (gtceu:wood_plate, made via gtceu:compressor/wood_mdf from tfg:chipboard_composite) was
 * actually fine, but pointed at a real, much bigger problem. A systematic scan of every
 * recipes_other/*.json for 100%-empty-input recipe TYPES (excluding ones already known to be
 * pure worldgen/repair/decorative-compat mechanics) found FIVE more TFC/addon recipe classes
 * with the same "generic getIngredients()/getIngredient() doesn't apply" gap as v6's PotRecipe,
 * all confirmed via javap, not guessed:
 *   - ChiselRecipe (extends the abstract SimpleBlockRecipe) - by far the biggest single find,
 *     1607 of 1607 recipes empty (practically every slab/stair/decorative variant of every
 *     building material in the pack runs through this one class). Works on Blocks/BlockStates,
 *     not ItemStacks: getBlockIngredient() (a BlockIngredient, same helper as TreeTapRecipe) is
 *     the input block, getItemIngredient() the required chisel tool (modeled as a normal
 *     consumed 1x input, same accepted simplification as every other TFC tool ingredient in
 *     this dump), getBlockRecipeOutput() the result Block (Block-item-id = Block-id, standard
 *     Forge convention, see ivd_blockId()) and getExtraDrop(ItemStack) an optional bonus drop
 *     (fed ItemStack.EMPTY since we don't simulate the actual tool stack).
 *   - GlassworkingRecipe - getBatchItem() instead of getIngredient() (66 recipes, e.g. colored
 *     glass panes/blocks); getResultItem() already worked here, only the input was missing.
 *   - KnappingRecipe - ONE concrete class for rock/clay/leather/goat-horn knapping. Its own
 *     getIngredient() is only populated for rock_knapping (the chosen rock/flint variant,
 *     already worked via the generic fallback); for clay/leather/goat-horn knapping it's
 *     always Ingredient.EMPTY, because those types don't offer a material CHOICE - the real
 *     fixed base material (1x clay ball / leather / goat horn) lives on the shared
 *     getKnappingType().inputItem() (an ItemStackIngredient) instead, one level up from the
 *     recipe itself. Explains 82 of 124 previously-empty tfc:knapping entries.
 *   - OverwritedWelding (net.witchkings.knightsofterrafirma.recipe) - a direct Java subclass
 *     of TFC's own WeldingRecipe with the identical getFirstInput()/getSecondInput() API, but
 *     a different getClass().getSimpleName() - the exact-string class check below simply never
 *     matched it. Explains all 130 of 370 previously-empty tfc:welding entries (100% of them
 *     knightsofterrafirma-authored). Checked every other specially-handled TFC class
 *     (anvil/casting/heating/bloomery/blast_furnace/tree_tapping) for the same subclass
 *     pattern - all at 0% empty, this was isolated to welding.
 *   - Firmalife's MixingBowlRecipe - identical shape to v6's PotRecipe fix
 *     (getItemIngredients() list + getFluidIngredient(), getResultItem() already fine) -
 *     folded into the same branch. 89 of 89 recipes previously empty.
 * Also confirmed, via the same scan, that the huge pile of 100%-empty gtceu:<machine-type>
 * entries in recipes_other (assembler, cutter, macerator, mixer, chemical_reactor, ... -
 * thousands of entries) is HARMLESS duplication, not a real gap: these are GTRecipe instances
 * authored by non-"gtceu" mods (tfg, create, ae2, ...) that slip past /itemvaluesdumpother's
 * mod==='gtceu' skip check, but every one of them is already correctly captured (with real
 * inputs, voltage, category) by the dedicated /itemvaluesdump sweep, which iterates each
 * GTCEU RecipeType's own category map regardless of authoring mod. Left as-is - not worth the
 * complexity of suppressing a harmless duplicate that load_recipes_with_types() already drops
 * via "no resolvable inputs" anyway.
 * NOT fixed (deliberately, to avoid guessing): tfc:sewing (49 recipes) has no exposed
 * ingredient accessor at all (getStitches()/getSquares() are pattern-complexity integers, not
 * item references) - the real consumed material is presumably a single hardcoded TFC item
 * (cloth?) not visible anywhere in the recipe class itself, would need live-game or source
 * verification before encoding a guess. domum_ornamentum's "architects_cutter" recipes (82,
 * output id === input id) look like a block-compatibility registration, not a real production
 * recipe - left alone. "railways:"/"tfcastikorcarts:" (727/435 items never referenced by ANY
 * recipe) have no registered recipe type in this dump AT ALL - not an extraction gap, either
 * these items have no crafting recipe in this pack (obtained some other way) or their
 * RecipeType isn't reached by RecipeManager.getRecipes() for a reason not yet investigated.
 *
 * v7 also fixes a SEPARATE, more subtle bug the user found by asking "if MDF was already
 * there, why didn't it show up in the LV circuit recipe?": su.terrafirmagreg.core.common.
 * recipe.ArtisanRecipe (this pack's "Artisan Table") used to share HeatingRecipe's branch
 * (ivd_r.getIngredient()), which is technically present but WRONG for this class - via javap
 * decompilation of ArtisanRecipe$Serializer.fromJson()/createIngredientFromType(), confirmed
 * that getIngredient() is built ENTIRELY from the recipe's shared ArtisanType definition
 * (getArtisanType().getInputIngredients(), combined into one Ingredient via vanilla
 * Ingredient.merge() - a genuine "any ONE of these materials", not a mis-extraction) and says
 * NOTHING about quantity. The real amount is the number of FILLED squares in the recipe's own
 * getPattern() (an ArtisanPattern - same grid-pattern concept as TFC's KnappingPattern, any
 * allowed material per square) - previously left unset, silently defaulting to 1 downstream.
 * Confirmed as a live, real bug: "tfg:artisan_table/resin_printed_circuit_board_4x" (23 filled
 * squares, each accepting gtceu:resin_circuit_board OR gtceu:copper_quadruple_wire) was
 * charging for 1 item instead of 23, undercutting the real, user-confirmed early circuit-board
 * route (assembler + gtceu:wood_plate/MDF) by roughly two orders of magnitude and hiding the
 * MDF requirement from every derived price. ArtisanRecipe now has its own branch:
 * getIngredient() for the material set (unchanged) + Long.bitCount(getPattern().getData())
 * for the amount (the pattern is a bit-packed long, one bit per square).
 *
 * API surface below confirmed via a smaller diagnostic script first
 * (probe_dump.js) against this instance's live GTCEU/KubeJS - not guessed:
 *   - GTCEuAPI.materialManager.getRegisteredMaterials() / .getMaterial(name)
 *   - GTRegistries.RECIPE_TYPES.keys() / .get(ResourceLocation.parse(id))
 *   - recipeType.getCategoryMap().entrySet() -> Set<GTRecipe> per category
 *   - recipe.duration, recipe.getInputEUt().voltage() (the real GTCEU tier
 *     signal - material properties like mass/blockHarvestLevel do NOT
 *     reliably encode tier, confirmed against known materials)
 *   - recipe.inputs / recipe.outputs: Map<RecipeCapability, List<Content>>;
 *     content.getContent() is a SizedIngredient (items - .getAmount(),
 *     .getStacks() -> ItemStack[], stack.getId() -> "modid:path" via
 *     KubeJS's own ItemStackKJS mixin), IntCircuitIngredient (GTCEU's
 *     non-physical "programmed circuit" config slot, not a real item), or
 *     a GTCEU FluidIngredient (.amount, .getStacks() -> FluidStack[] -
 *     fluid id resolution is best-effort here, not yet confirmed against
 *     live data, so failures there fall back to a null id rather than
 *     aborting the whole recipe).
 *
 * All local vars/functions are prefixed ivd_ - this pack's ~100
 * server_scripts files share one top-level Rhino scope (main_server_script.js
 * calls functions defined in other mod folders with no require/import), and
 * plain names collided with other scripts' globals during development.
 * const/let are avoided in favor of var: KubeJS/Rhino here throws
 * "redeclaration of var X" if a command's callback (which can run more than
 * once across reloads within the same persistent scope) redeclares a
 * const/let - var doesn't have that problem since JS allows var redeclaration.
 */

// NOTE: java.nio/java.io are blocked outright by KubeJS's class filter (confirmed
// in this instance's own kubejs/server_scripts/s3_progression_mod/progression_commands.js
// comment - not a guess). Using KubeJS's own JsonIO class instead, which is exempt.
// JsonIO.write's declared parameter type is specifically JsonObject (not the general
// JsonElement), so ivd_obj must always be a plain object, never a bare array - callers
// wrap arrays as e.g. { materials: [...] } for exactly this reason.
function ivd_writeJson(ivd_relPath, ivd_obj) {
    var ivd_json = JSON.stringify(ivd_obj)
    var ivd_element = JsonIO.parseRaw(ivd_json)
    JsonIO.write(ivd_relPath, ivd_element)
    return ivd_json.length
}

// Turns a recipe's inputs/outputs map (RecipeCapability -> List<Content>) into
// a plain JS array of {cap, ids, amount, chanced, chance, maxChance} objects.
// ids is an array because tag-based ingredients ("any plank", "any dust of X")
// can match more than one real item - capped at 8 to keep file size sane,
// with idsTruncated:true if there were more.
// Shared by /itemvaluesdumpother's per-class special cases below: pulls
// real "modid:path" item ids out of a plain vanilla Ingredient via KubeJS's
// own IngredientKJS mixin (.getItemIds(), confirmed present on the base
// Ingredient class itself via ProbeJS internals - not GTCEU-specific).
function ivd_ingredientIds(ivd_ingredient) {
    var ivd_ids = []
    try {
        var ivd_n = 0
        for (var ivd_iid of ivd_ingredient.getItemIds()) {
            if (ivd_n >= 8) break
            ivd_n++
            ivd_ids.push(String(ivd_iid))
        }
    } catch (e) { }
    return ivd_ids
}

// TFC's BlockIngredient (net.dries007.tfc.common.recipes.ingredients.BlockIngredient - used
// by e.g. AFC's TreeTapRecipe.getBlockIngredient(), confirmed via javap decompilation of
// afc-*.jar/TerraFirmaCraft-*.jar, not guessed) has no KubeJS item-id-style convenience
// mixin - .blocks() returns real Block objects instead of ids. Block has no confirmed
// direct .id accessor via KubeJS here (unlike ItemStackKJS's stack.getId()), so resolve via
// ForgeRegistries.BLOCKS.getKey() the same way GTCEU/TFC fluids are already resolved
// elsewhere in this file via a registry lookup.
function ivd_blockIngredientIds(ivd_blockIngredient) {
    var ivd_ids = []
    try {
        var ivd_ForgeRegistriesBlocks = Java.loadClass('net.minecraftforge.registries.ForgeRegistries').BLOCKS
        var ivd_n = 0
        for (var ivd_block of ivd_blockIngredient.blocks()) {
            if (ivd_n >= 8) break
            try {
                var ivd_bid = ivd_ForgeRegistriesBlocks.getKey(ivd_block)
                if (ivd_bid) {
                    ivd_ids.push(String(ivd_bid))
                    ivd_n++
                }
            } catch (e2) { }
        }
    } catch (e) { }
    return ivd_ids
}

// Einzelnes Block -> Item-ID (Standard-Minecraft/Forge-Konvention: ein normaler Block hat
// ein BlockItem unter DERSELBEN ID) - für ChiselRecipe.getBlockRecipeOutput() (liefert einen
// Block, kein ItemStack, siehe dortiger Kommentar). Dieselbe Registry-Lookup-Technik wie
// ivd_blockIngredientIds() oben, nur für ein einzelnes Objekt statt einer Liste.
function ivd_blockId(ivd_block) {
    try {
        var ivd_ForgeRegistriesBlocks2 = Java.loadClass('net.minecraftforge.registries.ForgeRegistries').BLOCKS
        var ivd_bid2 = ivd_ForgeRegistriesBlocks2.getKey(ivd_block)
        return ivd_bid2 ? String(ivd_bid2) : null
    } catch (e) { return null }
}

// TFC's OWN FluidIngredient (net.dries007.tfc.common.recipes.ingredients.
// FluidIngredient - wrapped inside a FluidStackIngredient, itself returned
// by e.g. CastingRecipe.getFluidIngredient()/BloomeryRecipe.getInputFluid())
// is a DIFFERENT class from GTCEU's own FluidIngredient and has no
// KubeJS convenience mixin for ids - confirmed via ProbeJS internals it
// has getMatchingFluidStacks(): List<FluidStack> instead. Resolve each
// FluidStack's real id the same registry-holder-key path already proven to
// work for GTCEU fluids earlier in this file. First attempt here just
// used .toString() as a placeholder note - that made every TFC casting/
// bloomery/barrel recipe's fluid requirement (e.g. molten steel) silently
// vanish from cost calculations (ids stayed empty, so the input got
// skipped entirely) instead of being priced or blocking availability -
// confirmed as the reason tfg:casting/steel_ingot_ceramic looked like a
// nearly-free Bronze-era recipe for gtceu:steel_ingot with only a cheap
// ceramic mold and no molten metal cost at all.
// Correction: the runtime class here is actually
// net.dries007.tfc.common.recipes.ingredients.FluidIngredient (a Java
// Record with an entries() list - confirmed via the debug toString format
// "FluidIngredient[entries=[ObjEntry[object=...]]]" and the matching
// ProbeJS class def), NOT the unrelated same-named abstract FluidIngredient
// class first assumed (which has getMatchingFluidStacks() but turned out
// to belong to a different mod entirely - simple-name collisions across
// ~262 mods strike again). This one has .fluids(): Collection<Fluid>
// directly - no FluidStack detour needed.
function ivd_tfcFluidIds(ivd_tfcFluidIngredient) {
    var ivd_ids = []
    try {
        var ivd_n = 0
        for (var ivd_fluid of ivd_tfcFluidIngredient.fluids()) {
            if (ivd_n >= 8) break
            ivd_n++
            try { ivd_ids.push(ivd_fluid.builtInRegistryHolder().key().location().toString()) } catch (e) { }
        }
    } catch (e) { }
    return ivd_ids
}

function ivd_resolveContents(ivd_map) {
    var ivd_result = []
    for (var ivd_entry of ivd_map.entrySet()) {
        var ivd_capName = 'unknown'
        try { ivd_capName = ivd_entry.getKey().toString() } catch (e) { }
        for (var ivd_content of ivd_entry.getValue()) {
            var ivd_out = { cap: 'other', ids: [], amount: null, chanced: false, chance: null, maxChance: null, idsTruncated: false }
            try { ivd_out.chanced = ivd_content.isChanced() } catch (e) { }
            try { ivd_out.chance = ivd_content.chance } catch (e) { }
            try { ivd_out.maxChance = ivd_content.maxChance } catch (e) { }
            try {
                var ivd_inner = ivd_content.getContent()
                var ivd_className = ivd_inner.getClass().getSimpleName()
                if (ivd_className === 'SizedIngredient') {
                    ivd_out.cap = 'item'
                    try { ivd_out.amount = ivd_inner.getAmount() } catch (e) { }
                    var ivd_stacks = ivd_inner.getStacks()
                    var ivd_i = 0
                    for (var ivd_stack of ivd_stacks) {
                        if (ivd_i >= 8) { ivd_out.idsTruncated = true; break }
                        ivd_i++
                        try { ivd_out.ids.push(ivd_stack.getId()) } catch (e2) { }
                    }
                } else if (ivd_className === 'IntCircuitIngredient') {
                    ivd_out.cap = 'circuit'
                } else if (ivd_className === 'FluidIngredient' || ivd_className === 'IntProviderFluidIngredient') {
                    ivd_out.cap = 'fluid'
                    try { ivd_out.amount = ivd_inner.amount } catch (e) { }
                    try {
                        var ivd_fstacks = ivd_inner.getStacks()
                        var ivd_j = 0
                        for (var ivd_fstack of ivd_fstacks) {
                            if (ivd_j >= 8) { ivd_out.idsTruncated = true; break }
                            ivd_j++
                            try { ivd_out.ids.push(ivd_fstack.getFluid().builtInRegistryHolder().key().location().toString()) } catch (e3) { }
                        }
                    } catch (e4) { }
                } else {
                    ivd_out.cap = ivd_className
                }
            } catch (e5) { ivd_out.cap = 'ERROR: ' + e5 }
            ivd_result.push(ivd_out)
        }
    }
    return ivd_result
}

ServerEvents.commandRegistry(event => {
    var { commands: ivd_Commands } = event

    // Cheap standalone smoke test for the JsonIO-based file writer alone, so a
    // wrong guess about JsonIO's API shows up in under a second instead of
    // after minutes of materials+recipe iteration.
    event.register(
        ivd_Commands.literal('itemvaluestest').requires(ivd_src => ivd_src.hasPermission(2)).executes(ivd_ctx => {
            console.log('===ITEMVALUES-TEST-START===')
            try {
                var ivd_bytes = ivd_writeJson('kubejs/exported/item_values/_writetest.json', { hello: 'world', numbers: [1, 2, 3], nested: { a: true } })
                console.log('write OK, ' + ivd_bytes + ' bytes')
            } catch (e) {
                console.log('write FAILED: ' + e)
            }
            console.log('===ITEMVALUES-TEST-END===')
            return 1
        })
    )

    event.register(
        ivd_Commands.literal('itemvaluesdump').requires(ivd_src => ivd_src.hasPermission(2)).executes(ivd_ctx => {
            console.log('===ITEMVALUES-DUMP-START===')
            var ivd_startTime = Date.now()

            // --- materials, written first as a quick smoke test of file I/O ---
            try {
                var ivd_matList = []
                var ivd_allMats = GTCEuAPI.materialManager.getRegisteredMaterials()
                for (var ivd_m of ivd_allMats) {
                    var ivd_entry = { id: null, name: null, mass: null, blockHarvestLevel: null, blastTemperature: null, hasTool: false, components: [] }
                    try { ivd_entry.id = ivd_m.getResourceLocation().toString() } catch (e) { }
                    try { ivd_entry.name = ivd_m.getName() } catch (e) { }
                    try { ivd_entry.mass = ivd_m.getMass() } catch (e) { }
                    try { ivd_entry.blockHarvestLevel = ivd_m.getBlockHarvestLevel() } catch (e) { }
                    try { ivd_entry.blastTemperature = ivd_m.getBlastTemperature() } catch (e) { }
                    try { ivd_m.getToolTier(); ivd_entry.hasTool = true } catch (e) { ivd_entry.hasTool = false }
                    try {
                        for (var ivd_c of ivd_m.getMaterialComponents()) {
                            try { ivd_entry.components.push({ id: ivd_c.material().getResourceLocation().toString(), amount: ivd_c.amount() }) } catch (e2) { }
                        }
                    } catch (e) { }
                    ivd_matList.push(ivd_entry)
                }
                var ivd_matBytes = ivd_writeJson('kubejs/exported/item_values/materials.json', { materials: ivd_matList })
                console.log('materials.json written: ' + ivd_matList.length + ' materials, ' + ivd_matBytes + ' bytes')
            } catch (e) {
                console.log('MATERIALS DUMP FAILED: ' + e)
                console.log('===ITEMVALUES-DUMP-END (aborted, file I/O looks broken - fix before retrying recipes)===')
                return 1
            }

            // --- recipes, one file per recipe type ---
            var ivd_typeIndex = []
            try {
                var ivd_recipeTypeRegistry = GTRegistries.RECIPE_TYPES
                var ivd_typeKeys = ivd_recipeTypeRegistry.keys()
                var ivd_totalTypes = ivd_typeKeys.size()
                console.log('recipe type count: ' + ivd_totalTypes)
                var ivd_typeNum = 0
                for (var ivd_key of ivd_typeKeys) {
                    ivd_typeNum++
                    var ivd_typeId = 'unknown'
                    try { ivd_typeId = ivd_key.toString() } catch (e) { }
                    var ivd_fileSafeId = ivd_typeId.replace(':', '_')
                    try {
                        var ivd_type = ivd_recipeTypeRegistry.get(ivd_key)
                        var ivd_recipeList = []
                        for (var ivd_catEntry of ivd_type.getCategoryMap().entrySet()) {
                            var ivd_categoryName = 'unknown'
                            try { ivd_categoryName = ivd_catEntry.getKey().name } catch (e) { }
                            for (var ivd_recipe of ivd_catEntry.getValue()) {
                                var ivd_rEntry = { id: null, category: ivd_categoryName, duration: null, voltage: null, inputs: [], outputs: [] }
                                try { ivd_rEntry.id = ivd_recipe.getId().toString() } catch (e) { }
                                try { ivd_rEntry.duration = ivd_recipe.duration } catch (e) { }
                                try { ivd_rEntry.voltage = ivd_recipe.getInputEUt().voltage() } catch (e) { }
                                try { ivd_rEntry.inputs = ivd_resolveContents(ivd_recipe.inputs) } catch (e) { }
                                try { ivd_rEntry.outputs = ivd_resolveContents(ivd_recipe.outputs) } catch (e) { }
                                ivd_recipeList.push(ivd_rEntry)
                            }
                        }
                        var ivd_bytes = ivd_writeJson('kubejs/exported/item_values/recipes/' + ivd_fileSafeId + '.json', { type: ivd_typeId, recipes: ivd_recipeList })
                        ivd_typeIndex.push({ type: ivd_typeId, file: ivd_fileSafeId + '.json', count: ivd_recipeList.length })
                        console.log('[' + ivd_typeNum + '/' + ivd_totalTypes + '] ' + ivd_typeId + ': ' + ivd_recipeList.length + ' recipes, ' + ivd_bytes + ' bytes')
                    } catch (e) {
                        console.log('[' + ivd_typeNum + '/' + ivd_totalTypes + '] ' + ivd_typeId + ' FAILED: ' + e)
                        ivd_typeIndex.push({ type: ivd_typeId, file: null, count: 0, error: String(e) })
                    }
                }
                ivd_writeJson('kubejs/exported/item_values/recipes/_index.json', { types: ivd_typeIndex })
            } catch (e) {
                console.log('RECIPE TYPES SECTION FAILED: ' + e)
            }

            var ivd_elapsed = Date.now() - ivd_startTime
            console.log('===ITEMVALUES-DUMP-END=== (' + ivd_elapsed + ' ms)')
            try { ivd_ctx.source.sendSuccess(Text.of('itemvalues dump done in ' + ivd_elapsed + ' ms, check kubejs/exported/item_values/'), false) } catch (e) { }
            return 1
        })
    )

    // TFC and Create recipes are NOT GTCEU machine recipes - they're
    // ordinary vanilla-style Recipe/RecipeType registrations (bloomery,
    // anvil, quern, heating, ... / milling, mixing, pressing, cutting, ...),
    // so GTRegistries.RECIPE_TYPES above doesn't see them at all. Read them
    // generically instead via the level's own RecipeManager, which holds
    // every registered recipe regardless of mod. KubeJS's own RecipeKJS
    // mixin (confirmed via ProbeJS internals, applied to the base Recipe
    // interface itself) gives every recipe object .getMod(), .getIngredients()
    // and .getResultItem(registryAccess) uniformly - but several TFC recipe
    // types (bloomery/blast_furnace/anvil/heating/casting/welding/collapse/
    // landslide/knapping/chisel/...) are known to have complex,
    // non-ingredient-list-shaped logic and likely return ItemStack.EMPTY
    // from getResultItem() rather than really having no output - this dump
    // records resultEmpty:true for those rather than guessing further, so
    // the per-type empty-count printed to console/log shows exactly which
    // TFC/Create recipe types need type-specific handling in a follow-up
    // pass instead of silently losing that data.
    event.register(
        ivd_Commands.literal('itemvaluesdumpother').requires(ivd_src => ivd_src.hasPermission(2)).executes(ivd_ctx => {
            console.log('===ITEMVALUES-DUMP-OTHER-START===')
            var ivd_startTime2 = Date.now()
            try {
                var ivd_level = ivd_ctx.source.getLevel()
                var ivd_registryAccess = ivd_level.registryAccess()
                var ivd_recipeManager = ivd_level.getRecipeManager()
                var ivd_rawRecipes = ivd_recipeManager.getRecipes()
                console.log('getRecipes() raw class: ' + ivd_rawRecipes.getClass().getName() + ', size: ' + ivd_rawRecipes.size())

                // This MC/Forge version's RecipeManager.getRecipes() turned out to
                // return a nested Map<RecipeType, Map<ResourceLocation, Recipe>>
                // (confirmed empirically - a first attempt assuming a flat
                // Collection<Recipe> crashed with a TypeError whose message showed
                // this exact nested-map shape), not the flat Collection<Recipe>
                // older/vanilla docs describe - so flatten it here first. Detected
                // via duck-typing (does it have entrySet()?) rather than assumed,
                // so this still works if that assumption is ever wrong again.
                var ivd_flatRecipes = []
                var ivd_isMap = false
                try { ivd_rawRecipes.entrySet(); ivd_isMap = true } catch (e) { ivd_isMap = false }
                if (ivd_isMap) {
                    for (var ivd_outerEntry of ivd_rawRecipes.entrySet()) {
                        var ivd_innerMap = ivd_outerEntry.getValue()
                        try {
                            for (var ivd_innerEntry of ivd_innerMap.entrySet()) {
                                ivd_flatRecipes.push(ivd_innerEntry.getValue())
                            }
                        } catch (e) {
                            // not actually a nested map after all (or empty) - treat the value itself as a recipe
                            ivd_flatRecipes.push(ivd_innerMap)
                        }
                    }
                } else {
                    for (var ivd_direct of ivd_rawRecipes) {
                        ivd_flatRecipes.push(ivd_direct)
                    }
                }
                console.log('flattened recipe count: ' + ivd_flatRecipes.length)

                // Per the user: don't guess which mods might matter - a
                // hand-picked allowlist (['tfc','create','minecraft','tfg'])
                // silently dropped every OTHER mod's OWN native recipes, only
                // ever seeing an item if this pack's own tfg/tfc/minecraft-kjs
                // scripts happened to add or override a recipe for it under
                // one of those 4 namespaces. Confirmed as a real, wide gap,
                // not theoretical: the user found createdeco:iron_catwalk
                // priced from a single "minecraft:kjs/..." stonecutting
                // shortcut recipe (1 wrought iron ingot -> 4 catwalks) while
                // createdeco's OWN real crafting recipe (wrought iron PLATES,
                // per the user's own in-game check) was invisible - registered
                // under "createdeco", which wasn't in the allowlist at all.
                // This almost certainly affected many other items the same
                // way throughout the whole list, silently pricing from
                // whatever alternate/shortcut recipe happened to survive the
                // filter instead of the mod's real one.
                //
                // "gtceu"-authored recipes are skipped ONLY when their TYPE is
                // one of GTCEU's own processing-machine types (already dumped
                // far more richly - voltage/duration/category - by
                // /itemvaluesdump above; including those here too would just
                // duplicate ~58k recipes). Earlier this excluded EVERY
                // gtceu-mod recipe outright, which turned out wrong: GTCEU's
                // own datagen also registers plain vanilla-style recipes
                // (e.g. "minecraft:crafting_shaped") for its machine hull/
                // casing items under the "gtceu:" id namespace - those are
                // NOT one of GTRegistries.RECIPE_TYPES, so the dedicated
                // /itemvaluesdump sweep never sees them either, and the old
                // blanket mod-based skip here silently dropped them a second
                // time. Confirmed as the actual cause of an item-values gap
                // (not a genuine absence of a recipe): every checked GTCEU
                // machine controller/hull item - lv_macerator, mv_extractor,
                // hv_centrifuge, lv_assembler, ulv/lv/hv/... _machine_hull,
                // etc. - showed zero recipes in either existing dump, across
                // every voltage tier except one single "tfg:"-authored MV
                // hull recipe. Computed dynamically (not hardcoded) so this
                // keeps working if GTCEU adds/removes processing types later.
                var ivd_gtceuProcessingTypes = {}
                try {
                    for (var ivd_gtKey of GTRegistries.RECIPE_TYPES.keys()) {
                        ivd_gtceuProcessingTypes[ivd_gtKey.toString()] = true
                    }
                } catch (e) { }
                console.log('gtceu processing types already covered by /itemvaluesdump: ' + Object.keys(ivd_gtceuProcessingTypes).length)

                var ivd_byType = {}
                var ivd_modCounts = {}
                for (var ivd_r of ivd_flatRecipes) {
                    var ivd_mod = 'unknown'
                    try { ivd_mod = ivd_r.getMod() } catch (e) { }
                    ivd_modCounts[ivd_mod] = (ivd_modCounts[ivd_mod] || 0) + 1

                    var ivd_typeId = 'unknown'
                    try { ivd_typeId = ivd_r.getType().toString() } catch (e) { }

                    if (ivd_mod === 'gtceu' && ivd_gtceuProcessingTypes[ivd_typeId]) continue

                    var ivd_entry = { id: null, mod: ivd_mod, tfcTier: null, inputs: [], resultId: null, resultCount: null, resultEmpty: true, extraOutputs: [] }
                    try { ivd_entry.id = ivd_r.getId().toString() } catch (e) { }

                    // TFC's own recipe classes (anvil/heating/welding/casting/
                    // bloomery/blast_furnace) don't populate the generic
                    // Recipe.getIngredients() at all (confirmed empirically -
                    // 100% empty across every single one in an earlier dump).
                    // Each has its own bespoke input field instead, found via
                    // ProbeJS internals (kubejs/probe/generated/internals/*.d.ts):
                    // HeatingRecipe.getIngredient(), AnvilRecipe.getInput()+
                    // getMinTier(), WeldingRecipe.getFirstInput()+
                    // getSecondInput()+getTier(), CastingRecipe.getIngredient()
                    // (the mold) + getFluidIngredient() (the molten metal -
                    // only a descriptive note is captured, not a real fluid id,
                    // see below), BloomeryRecipe/BlastFurnaceRecipe.getCatalyst()
                    // + getInputFluid() (same fluid caveat). getMinTier()/
                    // getTier() are TFC's OWN numeric tier scale (0=stone,
                    // 1=copper, 2=bronze, ...) - captured as tfcTier for a
                    // possible extra tier-floor signal, independent from the
                    // GTCEU-voltage-based tier ladder.
                    var ivd_specialInputs = null
                    try {
                        var ivd_className2 = ivd_r.getClass().getSimpleName()
                        if (ivd_className2 === 'HeatingRecipe') {
                            ivd_specialInputs = [{ ids: ivd_ingredientIds(ivd_r.getIngredient()) }]
                            // HeatingRecipe's real "product" for ore/ingot ->
                            // molten metal melting is a FLUID, never an
                            // ItemStack - getResultItem() (called
                            // unconditionally below for every recipe class)
                            // always returns empty for these (confirmed: every
                            // metal-melting entry in the raw dump had
                            // resultEmpty:true, resultId:null), so without
                            // this the recipe silently produced NOTHING,
                            // leaving e.g. fluid:gtceu:copper with zero
                            // producer recipes at all (falling back to the
                            // flat RAW_RESOURCE_COST placeholder as if it
                            // were a raw material, instead of a real cost
                            // derived from the ore/ingot actually melted) -
                            // found while sanity-checking gtceu:steel_ingot's
                            // new (post fluid-id-fix) price and noticing its
                            // ~145 cost was almost entirely the flat
                            // 1.00-per-mB fallback, not a real bloomery/blast-
                            // furnace-derived cost. getDisplayOutputFluid()
                            // gives the nominal output FluidStack directly
                            // (confirmed via ProbeJS internals - a no-arg
                            // getter, unlike assembleFluid() which needs a
                            // live inventory).
                            try {
                                var ivd_outFluidStack = ivd_r.getDisplayOutputFluid()
                                if (ivd_outFluidStack && !ivd_outFluidStack.isEmpty()) {
                                    var ivd_outFid = ivd_outFluidStack.getFluid().builtInRegistryHolder().key().location().toString()
                                    ivd_entry.extraOutputs.push({ cap: 'fluid', id: ivd_outFid, amount: ivd_outFluidStack.getAmount() })
                                }
                            } catch (e) { }
                        } else if (ivd_className2 === 'ArtisanRecipe') {
                            // su.terrafirmagreg.core.common.recipe.ArtisanRecipe (this pack's
                            // own "Artisan Table" custom machine, TFG mod).
                            // CORRECTED (autonome Session, v8): the v7 extraction used
                            // getIngredient() (a merged "any ONE of these" Ingredient built by
                            // ArtisanType's createIngredientFromType() via vanilla
                            // Ingredient.merge()) together with Long.bitCount(getPattern().
                            // getData()) as a single "amount" - i.e. modeled every artisan
                            // recipe as "N total units of whichever allowed material is
                            // cheapest". Direct javap decompilation of ArtisanType.class's
                            // static initializer (all 8 types: CASTING_MOLD, EXTRUDER_MOLD,
                            // RESIN_BOARD(_FOUR), PHENOLIC_BOARD(_FOUR), GLASS_LENS,
                            // ROAD_MARKING_STENCIL) proves this was wrong on BOTH counts:
                            // 1) the pattern's filled-square count (ArtisanPattern.getData(),
                            //    confirmed via javap to be a pure width<=6/height<=6 shape
                            //    bitmask with no per-cell material tag) has NO relation to
                            //    material cost at all - e.g. resin_board and resin_board_4x
                            //    share the EXACT same 23-square pattern string yet need
                            //    completely different fixed amounts (see below), and
                            //    road_marking_stencil's ~30 distinct stencil patterns all use
                            //    the SAME fixed 1x-plate cost regardless of shape.
                            // 2) each ArtisanType's constructor takes up to TWO SEPARATE
                            //    material Ingredient slots (ArtisanType$Ingredient, each
                            //    wrapping either a concrete ItemStack+count or a TagKey - never
                            //    both, isItemStack()/isTag()), stored uncombined in
                            //    getInputIngredients(); when both slots are non-null they are
                            //    BOTH required together (matches() in ArtisanRecipe checks each
                            //    of up to 2 distinct placed item types individually against the
                            //    merged Ingredient, it does not encode "either/or") - e.g.
                            //    RESIN_BOARD hardcodes 1x gtceu:resin_circuit_board (registry
                            //    field name COATED_BOARD, tooltip literally "A Coated Board")
                            //    PLUS a SEPARATE fixed 8x gtceu:copper_single_wire (a distinct
                            //    stack of the wireGtSingle/Copper item, not a per-square
                            //    substitute) - confirmed by user report that
                            //    resin_printed_circuit_board (Steel-gated via its
                            //    resin_circuit_board requirement) was wrongly priced from
                            //    Bronze, because the merged-ingredient model let the solver
                            //    pick 23x of the far cheaper, Bronze-available copper wire
                            //    instead of requiring the actual board.
                            // Fix: read getArtisanType().getInputIngredients() directly and
                            // emit ONE separate {ids, amount} input per slot (never merged),
                            // using each slot's own concrete ItemStack count (or, for the tag
                            // case - not observed on any real material slot in this pack's 8
                            // types, only on TOOL slots which are getTools()/getToolRequirements()
                            // and correctly never consumed here - resolved defensively via a
                            // ForgeRegistries tag lookup) as that input's amount. The pattern's
                            // bit count is no longer used for cost at all.
                            ivd_specialInputs = []
                            try {
                                for (var ivd_artIng of ivd_r.getArtisanType().getInputIngredients()) {
                                    try {
                                        if (ivd_artIng.isItemStack()) {
                                            var ivd_artStack = ivd_artIng.getItemStack()
                                            if (ivd_artStack && !ivd_artStack.isEmpty()) {
                                                ivd_specialInputs.push({ ids: [String(ivd_artStack.getId())], amount: ivd_artStack.getCount() })
                                            }
                                        } else if (ivd_artIng.isTag()) {
                                            var ivd_artTagIds = []
                                            try {
                                                var ivd_ForgeRegistriesItems = Java.loadClass('net.minecraftforge.registries.ForgeRegistries').ITEMS
                                                var ivd_n = 0
                                                for (var ivd_titem of ivd_ForgeRegistriesItems.tags().getTag(ivd_artIng.getTag())) {
                                                    if (ivd_n >= 8) break
                                                    ivd_artTagIds.push(String(ivd_ForgeRegistriesItems.getKey(ivd_titem)))
                                                    ivd_n++
                                                }
                                            } catch (e2) { }
                                            if (ivd_artTagIds.length > 0) ivd_specialInputs.push({ ids: ivd_artTagIds, amount: 1 })
                                        }
                                    } catch (e2) { }
                                }
                            } catch (e) { }
                            if (ivd_specialInputs.length === 0) {
                                // defensive fallback only - no ArtisanType in this pack has
                                // ever been observed to hit this (every real type has at least
                                // one non-null material Ingredient)
                                ivd_specialInputs = [{ ids: ivd_ingredientIds(ivd_r.getIngredient()), amount: 1 }]
                            }
                        } else if (ivd_className2 === 'AlloyRecipe') {
                            // TFC's AlloyRecipe (getRanges(): Map<Reference<Metal>,
                            // AlloyRecipe$Range> + getResult(): Metal) is a THIRD
                            // custom recipe shape - it defines a valid RATIO
                            // RANGE (min/max fraction) per component metal
                            // rather than a fixed ingredient list, and its
                            // result is a Metal (molten in a crucible, i.e. a
                            // fluid), never an ItemStack - confirmed every
                            // alloy recipe in the raw dump had inputs:[],
                            // resultEmpty:true (getIngredients()/
                            // getResultItem() both blank for this class).
                            // This was the OTHER half of why e.g.
                            // gtceu:bronze_ingot looked "free" (RAW_RESOURCE_
                            // COST fallback) despite needing molten bronze:
                            // bronze has no direct ore, only this alloying
                            // step, and without it fluid:gtceu:bronze had no
                            // producer recipe at all.
                            // Modeled as a fluid-to-fluid recipe: each
                            // component's fraction is approximated by the
                            // MIDPOINT of its valid range (the real recipe
                            // lets the player pick any ratio in range -
                            // midpoint is the simplest defensible single
                            // estimate, documented here rather than hidden),
                            // normalized so all components sum to 144 mB of
                            // alloy (this pack's standard ingot-mold casting
                            // unit throughout - every casting recipe seen
                            // consumes exactly 144mB per ingot) per 144mB
                            // total input - NOT 1 mB: the cost model charges
                            // a flat per-craft overhead (OPERATION_FEE)
                            // regardless of output amount, so declaring a
                            // "produces 1 mB" recipe made that flat fee
                            // ~144x too expensive per mB versus every other
                            // fluid recipe in the dataset (which all report
                            // real multi-hundred-mB amounts) - confirmed as
                            // the reason gtceu:bronze_ingot priced far
                            // higher (8.67) than its copper+tin components
                            // alone would suggest, entirely from this
                            // overhead artifact, not real material cost.
                            try {
                                var ivd_fracs = []
                                var ivd_fracSum = 0
                                for (var ivd_rangeEntry of ivd_r.getRanges().entrySet()) {
                                    var ivd_metal = ivd_rangeEntry.getKey().get()
                                    var ivd_range = ivd_rangeEntry.getValue()
                                    var ivd_frac = (ivd_range.min() + ivd_range.max()) / 2
                                    try {
                                        var ivd_compFid = ivd_metal.getFluid().builtInRegistryHolder().key().location().toString()
                                        ivd_fracs.push({ id: ivd_compFid, frac: ivd_frac })
                                        ivd_fracSum += ivd_frac
                                    } catch (e) { }
                                }
                                if (ivd_fracs.length > 0 && ivd_fracSum > 0) {
                                    ivd_specialInputs = []
                                    for (var ivd_fc of ivd_fracs) {
                                        ivd_specialInputs.push({ ids: [ivd_fc.id], fluidAmount: (ivd_fc.frac / ivd_fracSum) * 144 })
                                    }
                                    var ivd_resultMetal = ivd_r.getResult()
                                    var ivd_resultFid = ivd_resultMetal.getFluid().builtInRegistryHolder().key().location().toString()
                                    ivd_entry.extraOutputs.push({ cap: 'fluid', id: ivd_resultFid, amount: 144 })
                                }
                            } catch (e) { }
                        } else if (ivd_className2 === 'TreeTapRecipe') {
                            // AFC's Baumzapf-Rezept (com.therighthon.afc.common.recipe.
                            // TreeTapRecipe, confirmed via javap - kein KubeJS-Recipe-Mixin
                            // deckt diese Klasse ab, getIngredients()/getResultItem() liefern
                            // dafür beide leer, siehe der Grund, warum dieser Zweig hier nötig
                            // wurde: raw_rubber_dust/Kabel/jede GTCEU-Maschine hingen am Ende
                            // an dieser einen ungehandhabten Klasse). getBlockIngredient()
                            // gibt den anzapfbaren Block zurück (nicht verbraucht - man zapft
                            // denselben Baum wiederholt an - hier trotzdem wie ein normaler
                            // 1x-Input behandelt, konsistent mit jedem anderen "nachwachsenden"
                            // Rohstoff in diesem Dump, z. B. einem Baumstamm für eine Planke).
                            // getOutput() liefert einen FluidStack direkt (reines Fluid-
                            // Ergebnis, kein ItemStack - derselbe Fall wie HeatingRecipe/
                            // BlastFurnaceRecipe oben).
                            ivd_specialInputs = [{ ids: ivd_blockIngredientIds(ivd_r.getBlockIngredient()) }]
                            try {
                                var ivd_tapOutput = ivd_r.getOutput()
                                if (ivd_tapOutput && !ivd_tapOutput.isEmpty()) {
                                    var ivd_tapFid = ivd_tapOutput.getFluid().builtInRegistryHolder().key().location().toString()
                                    ivd_entry.extraOutputs.push({ cap: 'fluid', id: ivd_tapFid, amount: ivd_tapOutput.getAmount() })
                                }
                            } catch (e) { }
                        } else if (ivd_className2 === 'AnvilRecipe') {
                            ivd_specialInputs = [{ ids: ivd_ingredientIds(ivd_r.getInput()) }]
                            try { ivd_entry.tfcTier = ivd_r.getMinTier() } catch (e) { }
                        } else if (ivd_className2 === 'WeldingRecipe' || ivd_className2 === 'OverwritedWelding') {
                            // knightsofterrafirma registriert alle seine Schweiß-Rezepte
                            // (130 von 370, komplett verschwunden aus dem bisherigen Dump)
                            // über net.witchkings.knightsofterrafirma.recipe.OverwritedWelding,
                            // eine direkte Unterklasse von TFCs WeldingRecipe mit denselben
                            // getFirstInput()/getSecondInput()-Methoden (via javap bestätigt) -
                            // der exakte Klassennamen-Vergleich unten hat das bisher NICHT
                            // erfasst, weil getSimpleName() für eine Unterklasse einen anderen
                            // Namen liefert, auch wenn die gesamte API identisch geerbt ist.
                            // Gezielt gegen alle anderen speziell behandelten TFC-Klassen
                            // geprüft (anvil/casting/heating/bloomery/blast_furnace/
                            // tree_tapping) - dort 0 leere Inputs, dieses Muster ist auf
                            // Welding/knightsofterrafirma beschränkt.
                            ivd_specialInputs = [
                                { ids: ivd_ingredientIds(ivd_r.getFirstInput()) },
                                { ids: ivd_ingredientIds(ivd_r.getSecondInput()) },
                            ]
                            try { ivd_entry.tfcTier = ivd_r.getTier() } catch (e) { }
                        } else if (ivd_className2 === 'CastingRecipe') {
                            ivd_specialInputs = [{ ids: ivd_ingredientIds(ivd_r.getIngredient()) }]
                            try {
                                var ivd_fsiCast = ivd_r.getFluidIngredient()
                                ivd_specialInputs.push({ ids: ivd_tfcFluidIds(ivd_fsiCast.ingredient()), fluidAmount: ivd_fsiCast.amount() })
                            } catch (e) { }
                        } else if (ivd_className2 === 'BloomeryRecipe') {
                            ivd_specialInputs = []
                            try {
                                var ivd_catB = ivd_r.getCatalyst()
                                ivd_specialInputs.push({ ids: ivd_ingredientIds(ivd_catB.ingredient()), amount: ivd_catB.count() })
                            } catch (e) { }
                            try {
                                var ivd_fsiBloom = ivd_r.getInputFluid()
                                ivd_specialInputs.push({ ids: ivd_tfcFluidIds(ivd_fsiBloom.ingredient()), fluidAmount: ivd_fsiBloom.amount() })
                            } catch (e) { }
                        } else if (ivd_className2 === 'BlastFurnaceRecipe') {
                            ivd_specialInputs = []
                            try { ivd_specialInputs.push({ ids: ivd_ingredientIds(ivd_r.getCatalyst()) }) } catch (e) { }
                            try {
                                var ivd_fsiBlast = ivd_r.getInputFluid()
                                ivd_specialInputs.push({ ids: ivd_tfcFluidIds(ivd_fsiBlast.ingredient()), fluidAmount: ivd_fsiBlast.amount() })
                            } catch (e) { }
                            // Same fluid-only-result gap as HeatingRecipe
                            // (see comment there) - BlastFurnaceRecipe melts
                            // wrought iron + flux into molten pig iron, never
                            // an ItemStack (confirmed: raw dump had every
                            // entry resultEmpty:true, resultId:null). Found
                            // while tracing why gtceu:steel_ingot's cost
                            // still looked wrong after the Heating/Alloy fix
                            // (145 -> 1.05, via a hammering recipe consuming
                            // "tfc:metal/ingot/high_carbon_steel" - an id
                            // with NO producer recipe anywhere, so it was
                            // just a second flavor of the same free-fallback
                            // bug at one remove). getOutputFluid() gives the
                            // nominal output FluidStack directly (confirmed
                            // via ProbeJS internals, a no-arg getter -
                            // distinct from assembleFluidOutput(FluidStack)
                            // which needs a live input).
                            try {
                                var ivd_blastOutStack = ivd_r.getOutputFluid()
                                if (ivd_blastOutStack && !ivd_blastOutStack.isEmpty()) {
                                    var ivd_blastOutFid = ivd_blastOutStack.getFluid().builtInRegistryHolder().key().location().toString()
                                    ivd_entry.extraOutputs.push({ cap: 'fluid', id: ivd_blastOutFid, amount: ivd_blastOutStack.getAmount() })
                                }
                            } catch (e) { }
                        } else if (ivd_className2 === 'SequencedAssemblyRecipe') {
                            // Create's multi-step "belt sequence" crafting
                            // (circuits, train tracks, ...): getIngredient()
                            // is only the STARTING item threaded through the
                            // belt - each step in getSequence() (Deploying/
                            // Pressing/Cutting/...) is its own ProcessingRecipe
                            // that can consume ADDITIONAL items (e.g. a
                            // Deploying step adding a dye or plate), invisible
                            // if only the starting ingredient is captured.
                            // Confirmed as a real correctness bug, not just an
                            // undercount: the user found railways:track_monorail
                            // priced as BRONZE-tier from just its "metal_girder"
                            // starting ingredient, even though the recipe's own
                            // id (".../track_monorail/steel") and real behavior
                            // add STEEL during a later step - completely hidden
                            // before this fix, letting an actually-Iron-tier-or-
                            // later item slip through as if it were Bronze.
                            // getLoops() means the whole sequence repeats that
                            // many times, consuming each step's ingredients
                            // again per loop - modeled here as amount x loops.
                            ivd_specialInputs = [{ ids: ivd_ingredientIds(ivd_r.getIngredient()) }]
                            try {
                                // Each step's own ProcessingRecipe.getIngredients()
                                // lists EVERY input slot, including the one that
                                // actually matches the TRANSITIONAL item flowing
                                // in from the previous step (e.g. a Deploying
                                // step "track_incomplete_monorail + steel_plate
                                // -> track_incomplete_monorail") - that slot isn't
                                // something a player buys separately, it's the
                                // in-progress item itself. Left in, it shows up
                                // as a fake extra ingredient with no producer of
                                // its own, inflating cost with bogus raw-fallback
                                // charges. Filtered out by transitional item id.
                                var ivd_transId = null
                                try { ivd_transId = ivd_r.getTransitionalItem().getId() } catch (e) { }
                                var ivd_loops = ivd_r.getLoops() || 1
                                for (var ivd_seqEntry of ivd_r.getSequence()) {
                                    try {
                                        var ivd_stepRecipe = ivd_seqEntry.getRecipe()
                                        for (var ivd_stepIng of ivd_stepRecipe.getIngredients()) {
                                            var ivd_stepIds = ivd_ingredientIds(ivd_stepIng)
                                            if (ivd_transId) {
                                                ivd_stepIds = ivd_stepIds.filter(function (ivd_x) { return ivd_x !== ivd_transId })
                                            }
                                            if (ivd_stepIds.length > 0) {
                                                ivd_specialInputs.push({ ids: ivd_stepIds, amount: ivd_loops })
                                            }
                                        }
                                    } catch (e) { }
                                }
                            } catch (e) { }
                        } else if (ivd_className2 === 'SimplePotRecipe' || ivd_className2 === 'JamPotRecipe' || ivd_className2 === 'SoupPotRecipe' || ivd_className2 === 'MixingBowlRecipe') {
                            // TFC's Pot-Rezepte (net.dries007.tfc.common.recipes.PotRecipe,
                            // abstract - SimplePotRecipe/JamPotRecipe/SoupPotRecipe sind die
                            // konkreten Unterklassen, via javap bestätigt) haben WEDER die
                            // generische getIngredients() NOCH ein einfaches getIngredient()
                            // (SimpleItemRecipe-Fallback unten) - eigene getItemIngredients()
                            // (Liste!) + getFluidIngredient() stattdessen (100% leere Inputs
                            // im bisherigen Dump, "emptyResultCount": 148 von 148 für
                            // tfc:pot). Gefunden beim Zurückverfolgen von "Latex+Sulfur ->
                            // Vulcanized Latex" (Nutzer-bestätigt: passiert im TFC-Topf, nicht
                            // in einer GTCEU-Maschine) - ohne diesen Fix blockierte das
                            // fälschlich die GESAMTE Gummi/Kabel-Kette hinter einem nicht
                            // benötigten LV+-Chemical-Reactor.
                            // Firmalifes MixingBowlRecipe (com.eerussianguy.firmalife.common.
                            // recipes.MixingBowlRecipe, via javap bestätigt) hat exakt dieselbe
                            // Form (getItemIngredients()-Liste + getFluidIngredient(), Ergebnis
                            // bereits über das direkt gesetzte resultItem-Feld/getResultItem()
                            // funktionsfähig) - 89 von 89 Rezepten kamen bisher leer heraus.
                            ivd_specialInputs = []
                            try {
                                for (var ivd_potItemIng of ivd_r.getItemIngredients()) {
                                    ivd_specialInputs.push({ ids: ivd_ingredientIds(ivd_potItemIng) })
                                }
                            } catch (e) { }
                            try {
                                var ivd_potFsi = ivd_r.getFluidIngredient()
                                if (ivd_potFsi) {
                                    ivd_specialInputs.push({ ids: ivd_tfcFluidIds(ivd_potFsi.ingredient()), fluidAmount: ivd_potFsi.amount() })
                                }
                            } catch (e) { }
                            // Nur SimplePotRecipe hat ein statisch bekanntes Ergebnis
                            // (outputFluid-Feld direkt, via getDisplayFluid() - bestätigt via
                            // javap). Jam-/SoupPotRecipe berechnen ihr Ergebnis dynamisch aus
                            // dem AKTUELLEN Topf-Inhalt (Output.read()/onFinish() - keine
                            // statische Zutatenliste) - bewusst nicht nachgebildet, bleiben
                            // also weiterhin resultEmpty (kein Rateversuch an dieser Stelle).
                            if (ivd_className2 === 'SimplePotRecipe') {
                                try {
                                    var ivd_potOutFluid = ivd_r.getDisplayFluid()
                                    if (ivd_potOutFluid && !ivd_potOutFluid.isEmpty()) {
                                        var ivd_potOutFid = ivd_potOutFluid.getFluid().builtInRegistryHolder().key().location().toString()
                                        ivd_entry.extraOutputs.push({ cap: 'fluid', id: ivd_potOutFid, amount: ivd_potOutFluid.getAmount() })
                                    }
                                } catch (e) { }
                                try {
                                    for (var ivd_potProvider of ivd_r.getOutputProviders()) {
                                        var ivd_potStack = ivd_potProvider.getEmptyStack()
                                        if (ivd_potStack && !ivd_potStack.isEmpty()) {
                                            ivd_entry.extraOutputs.push({ cap: 'item', id: ivd_potStack.getId(), amount: ivd_potStack.getCount() })
                                        }
                                    }
                                } catch (e) { }
                            }
                        } else if (ivd_className2 === 'ChiselRecipe') {
                            // TFCs Meißel-Rezepte (ChiselRecipe extends dem abstrakten
                            // SimpleBlockRecipe, via javap bestätigt) arbeiten auf Blocks/
                            // BlockStates in der Welt, nicht auf ItemStacks - weder die
                            // generische getIngredients() noch getResultItem() liefern hier
                            // je etwas (100% leere Inputs bei 1607 Rezepten im bisherigen
                            // Dump - der mit Abstand größte einzelne Fund beim
                            // Nutzer-gemeldeten "~75% der Items fehlen"-Problem: praktisch
                            // jede Stufen-/Treppen-/Deko-Variante fast jedes Baumaterials
                            // läuft über diese eine Klasse). getBlockIngredient() ist der
                            // Eingangs-Block (wie TreeTapRecipe oben), getItemIngredient()
                            // das benötigte Meißel-Werkzeug (wie andere TFC-Werkzeug-Zutaten
                            // in diesem Skript als normaler, "verbrauchter" 1x-Input
                            // behandelt - dieselbe bereits akzeptierte Vereinfachung wie bei
                            // Hammer-/Messer-Werkzeugrezepten anderswo im Datensatz).
                            // getBlockRecipeOutput() liefert den Ergebnis-Block direkt (nicht
                            // den BlockState) - Block-Item-ID = Block-ID, Standard-Minecraft/
                            // Forge-Konvention (siehe ivd_blockId()). getExtraDrop() ist ein
                            // optionaler Bonus-Drop (z. B. Abfall-Material) über denselben
                            // ItemStackProvider-Typ wie bei SimplePotRecipe oben - hier
                            // versorgt mit ItemStack.EMPTY, da wir das tatsächlich benutzte
                            // Werkzeug-Stack nicht simulieren.
                            ivd_specialInputs = [
                                { ids: ivd_blockIngredientIds(ivd_r.getBlockIngredient()) },
                                { ids: ivd_ingredientIds(ivd_r.getItemIngredient()) },
                            ]
                            try {
                                var ivd_chiselOutId = ivd_blockId(ivd_r.getBlockRecipeOutput())
                                if (ivd_chiselOutId) {
                                    ivd_entry.extraOutputs.push({ cap: 'item', id: ivd_chiselOutId, amount: 1 })
                                }
                            } catch (e) { }
                            try {
                                var ivd_ItemStackClass = Java.loadClass('net.minecraft.world.item.ItemStack')
                                var ivd_chiselExtra = ivd_r.getExtraDrop(ivd_ItemStackClass.EMPTY)
                                if (ivd_chiselExtra && !ivd_chiselExtra.isEmpty()) {
                                    ivd_entry.extraOutputs.push({ cap: 'item', id: ivd_chiselExtra.getId(), amount: ivd_chiselExtra.getCount() })
                                }
                            } catch (e) { }
                        } else if (ivd_className2 === 'GlassworkingRecipe') {
                            // TFCs Glasbläser-Rezepte: getBatchItem() (ein Ingredient, das
                            // Rohglas-Gemenge) statt der generischen getIngredient() - via
                            // javap bestätigt (66 Rezepte, 100% leere Inputs im bisherigen
                            // Dump, z. B. farbige Glasscheiben/-blöcke). getResultItem()
                            // funktioniert hier bereits (resultItem-Feld direkt gesetzt,
                            // KEIN eigener Ausgabe-Fix nötig - anders als bei ChiselRecipe).
                            ivd_specialInputs = [{ ids: ivd_ingredientIds(ivd_r.getBatchItem()) }]
                        } else if (ivd_className2 === 'KnappingRecipe') {
                            // TFCs Knapping-Rezepte (Fels-/Ton-/Leder-/Widderhorn-Formen, EINE
                            // konkrete Klasse für alle Untertypen, via javap bestätigt) haben
                            // zwar ein eigenes getIngredient() - das ist aber bei
                            // clay_knapping/leather_knapping/goat_horn_knapping IMMER
                            // Ingredient.EMPTY (keine Zutaten-AUSWAHL beim Formen, jedes
                            // Rezept dieses Typs verbraucht dieselbe eine Grundzutat) - nur
                            // bei rock_knapping ist es die tatsächlich gewählte Gesteinsart
                            // (z. B. Feuerstein) und funktioniert schon über den generischen
                            // SimpleItemRecipe-Fallback. Das eigentliche Grundmaterial für die
                            // anderen Untertypen (1x Tonkugel/Lederstück/Widderhorn) steckt
                            // stattdessen in getKnappingType().inputItem() (ein
                            // ItemStackIngredient, GEMEINSAM für alle Rezepte dieses einen
                            // Knapping-Typs, nicht im Rezept selbst) - bestätigt als Ursache
                            // für 82 von 124 leeren tfc:knapping-Einträgen im bisherigen Dump
                            // (u. a. tfc:clay_knapping/blowpipe, tfc:leather_knapping/boots).
                            var ivd_knapIds = ivd_ingredientIds(ivd_r.getIngredient())
                            var ivd_knapAmount = 1
                            if (ivd_knapIds.length === 0) {
                                try {
                                    var ivd_knapTypeInput = ivd_r.getKnappingType().inputItem()
                                    ivd_knapIds = ivd_ingredientIds(ivd_knapTypeInput.ingredient())
                                    ivd_knapAmount = ivd_knapTypeInput.count() || 1
                                } catch (e) { }
                            }
                            ivd_specialInputs = [{ ids: ivd_knapIds, amount: ivd_knapAmount }]
                        } else {
                            // Generic fallback for every other TFC-style custom
                            // recipe class we haven't special-cased by exact
                            // name: several converge on the same shape TFC's
                            // shared (abstract) SimpleItemRecipe base class
                            // uses - a singular getIngredient() (confirmed:
                            // this covers at least Quern, Loom, Scraping in
                            // addition to Heating/Artisan above, all of which
                            // extend or mirror that base) - or the
                            // getInputItem()/getInputFluid() pair TFC's
                            // (abstract) BarrelRecipe base class uses (covers
                            // both instant and sealed barrel recipes). Tried
                            // in this order rather than by exact subclass
                            // name so this keeps working if TFC adds more
                            // recipe classes following the same conventions.
                            try {
                                ivd_specialInputs = [{ ids: ivd_ingredientIds(ivd_r.getIngredient()) }]
                            } catch (e) {
                                try {
                                    var ivd_specialList = []
                                    try {
                                        var ivd_ii = ivd_r.getInputItem()
                                        ivd_specialList.push({ ids: ivd_ingredientIds(ivd_ii.ingredient()), amount: ivd_ii.count() })
                                    } catch (e2) { }
                                    try {
                                        var ivd_fi = ivd_r.getInputFluid()
                                        ivd_specialList.push({ ids: ivd_tfcFluidIds(ivd_fi.ingredient()), fluidAmount: ivd_fi.amount() })
                                    } catch (e2) { }
                                    if (ivd_specialList.length > 0) ivd_specialInputs = ivd_specialList
                                } catch (e3) { }
                            }
                        }
                    } catch (e) { }

                    if (ivd_specialInputs) {
                        ivd_entry.inputs = ivd_specialInputs
                    } else {
                        try {
                            for (var ivd_ing of ivd_r.getIngredients()) {
                                ivd_entry.inputs.push({ ids: ivd_ingredientIds(ivd_ing) })
                            }
                        } catch (e) { }
                    }

                    // Create's ProcessingRecipe base class (com.simibubi.create.content.
                    // processing.recipe.ProcessingRecipe - used by Create's own Basin/
                    // Mixing/Compacting recipes AND every Vintage-Improvements machine that
                    // extends it, e.g. PressurizingRecipe/VacuumizingRecipe, confirmed via
                    // javap decompilation) stores fluid ingredients/results SEPARATELY from
                    // the standard Recipe.getIngredients()/getResultItem() (item-only) via its
                    // own getFluidIngredients()/getFluidResults() - so a fluid-only recipe
                    // (e.g. VI's "vulcanized_latex -> raw_rubber_dust" pressurizing step) came
                    // out as "inputs": [] before this fix, exactly like TFC's own bespoke
                    // classes above. Tried unconditionally via try/catch (not gated on class
                    // name) since it's shared by several different VI recipe classes at once -
                    // simply no-ops for any recipe that doesn't have these methods.
                    try {
                        for (var ivd_fluidIng of ivd_r.getFluidIngredients()) {
                            try {
                                var ivd_fIds = []
                                var ivd_fn = 0
                                for (var ivd_fStack of ivd_fluidIng.getMatchingFluidStacks()) {
                                    if (ivd_fn >= 8) break
                                    ivd_fIds.push(String(ivd_fStack.getFluid().builtInRegistryHolder().key().location()))
                                    ivd_fn++
                                }
                                if (ivd_fIds.length > 0) {
                                    ivd_entry.inputs.push({ ids: ivd_fIds, fluidAmount: ivd_fluidIng.getRequiredAmount() })
                                }
                            } catch (e2) { }
                        }
                    } catch (e) { }
                    try {
                        for (var ivd_fluidRes of ivd_r.getFluidResults()) {
                            if (ivd_fluidRes && !ivd_fluidRes.isEmpty()) {
                                ivd_entry.extraOutputs.push({
                                    cap: 'fluid',
                                    id: String(ivd_fluidRes.getFluid().builtInRegistryHolder().key().location()),
                                    amount: ivd_fluidRes.getAmount(),
                                })
                            }
                        }
                    } catch (e) { }

                    try {
                        var ivd_result = ivd_r.getResultItem(ivd_registryAccess)
                        if (ivd_result && !ivd_result.isEmpty()) {
                            ivd_entry.resultEmpty = false
                            ivd_entry.resultId = ivd_result.getId()
                            ivd_entry.resultCount = ivd_result.getCount()
                        }
                    } catch (e) { }
                    // A fluid-only result (HeatingRecipe melting, AlloyRecipe)
                    // has no ItemStack result at all, but does have a real,
                    // usable output via extraOutputs above - don't count it
                    // as "empty" in the per-type diagnostic log just because
                    // getResultItem() itself is blank.
                    if (ivd_entry.extraOutputs.length > 0) ivd_entry.resultEmpty = false

                    if (!ivd_byType[ivd_typeId]) ivd_byType[ivd_typeId] = []
                    ivd_byType[ivd_typeId].push(ivd_entry)
                }

                console.log('mod counts (all mods, before tfc/create filter): ' + JSON.stringify(ivd_modCounts))

                var ivd_typeIndex2 = []
                for (var ivd_typeId2 in ivd_byType) {
                    var ivd_list = ivd_byType[ivd_typeId2]
                    var ivd_emptyCount = 0
                    for (var ivd_e of ivd_list) { if (ivd_e.resultEmpty) ivd_emptyCount++ }
                    var ivd_fileSafe2 = ivd_typeId2.replace(':', '_').replace('/', '_')
                    var ivd_bytes2 = ivd_writeJson('kubejs/exported/item_values/recipes_other/' + ivd_fileSafe2 + '.json', { type: ivd_typeId2, recipes: ivd_list })
                    ivd_typeIndex2.push({ type: ivd_typeId2, file: ivd_fileSafe2 + '.json', count: ivd_list.length, emptyResultCount: ivd_emptyCount })
                    console.log(ivd_typeId2 + ': ' + ivd_list.length + ' recipes (' + ivd_emptyCount + ' empty result), ' + ivd_bytes2 + ' bytes')
                }
                ivd_writeJson('kubejs/exported/item_values/recipes_other/_index.json', { types: ivd_typeIndex2 })
            } catch (e) {
                console.log('OTHER RECIPES DUMP FAILED: ' + e)
            }
            var ivd_elapsed2 = Date.now() - ivd_startTime2
            console.log('===ITEMVALUES-DUMP-OTHER-END=== (' + ivd_elapsed2 + ' ms)')
            try { ivd_ctx.source.sendSuccess(Text.of('other-recipes dump done in ' + ivd_elapsed2 + ' ms, check kubejs/exported/item_values/recipes_other/'), false) } catch (e) { }
            return 1
        })
    )
})
