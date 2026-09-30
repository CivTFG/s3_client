/*
 * dump_world_data.js - v2. Dumps data that shows which items come from the WORLD and where
 * (loot tables, mob spawns per biome/dimension, blocks placed by worldgen, knapping inputs),
 * plus TFC barrel/heating data that dump_gtceu_data.js loses.
 * v2: added sections 5 (barrel.json) and 6 (heating.json). /itemvaluesdumpother drops the
 * OUTPUT FLUID of instant barrel recipes (e.g. tfc:barrel/limewater: flux + 500 mB water ->
 * limewater came out resultEmpty). It also has no heating temperature and no metal/fuel data.
 * Companion to dump_gtceu_data.js (/itemvaluesdump, /itemvaluesdumpother), same conventions.
 * Read-only: it only reads loaded server data and changes no game state.
 *
 * Install:  copy to <TFG instance>/kubejs/server_scripts/dump_world_data.js
 * Run:      /reload (or /kubejs reload server_scripts), then type in chat (op level 2 needed):
 *   /itemvaluesdumpworld            -> all sections, in this order: knapping, barrel, heating,
 *                                      loot, biomes, features
 *   /itemvaluesdumpworld knapping   -> only section 4 (small and fast, good first test)
 *   /itemvaluesdumpworld barrel     -> only section 5
 *   /itemvaluesdumpworld heating    -> only section 6
 *   /itemvaluesdumpworld loot       -> only section 1
 *   /itemvaluesdumpworld biomes     -> only section 2 (dimensions + spawns + biome feature lists)
 *   /itemvaluesdumpworld features   -> only section 3 (placed/configured feature registries)
 *   /itemvaluesdumpworld lootsim    -> v4, NOT part of "all": rolls the loot tables listed in
 *                                      lootsim_request.json (written by v3/lootsim.py) incl.
 *                                      LootJS modifiers -> lootsim.json (runs over many ticks)
 *   Progress and counts go to chat and to logs/latest.log (look for [itemvaluesdumpworld]).
 *
 * Output:   kubejs/exported/item_values/world/ (the folder has to exist because JsonIO.write
 *   cannot create folders and java.nio is blocked for scripts. The installer created it. If
 *   it is missing, the script falls back to kubejs/exported/item_values/world_<file>). Each
 *   file is written as soon as its section/bucket is finished, so a crash later keeps the
 *   earlier files. _index.json is rewritten after every section: counts, timestamps, files,
 *   and the first 5000 per-entry errors (errorCount holds the full count).
 *   1. loot_<group>_<namespace>.json   {group, namespace, tables:[{id, json, drops, error?}]}
 *        group = first path segment if blocks|entities|chests|gameplay|archaeology, else other.
 *        json  = the loaded LootTable serialized back with Minecraft's own loot Gson
 *                (LootDataType.TABLE.parser().toJsonTree(table)). This is the raw source of truth.
 *        drops = a best-effort flat summary derived from json in JS: one row per leaf entry
 *                {pool, kind, id, weight, quality, rolls:{min,max}, count:{min,max}|null,
 *                 functions:[..], conditions:[{type, chance?, ..., silkTouch?, inverted?}],
 *                 chain:["<composite type>#<child index>", ..]}.
 *      loot_index.json  {lootjsNote, tables:{<id>: {file, group, items:[..], tags:[..], refs:[..], error?}}}
 *      LootJS modifiers (event.addEntityLootModifier etc., e.g. primitive_creatures/loot.js) are
 *      NOT in these tables. They are applied at runtime as a global loot modifier. javap of
 *      lootjs-forge-1.20.1-2.13.1.jar shows they live in LootModificationsAPI.actions, a
 *      PRIVATE static List with no getter. AbstractLootModification.name is private too, and
 *      java.lang.reflect is blocked for scripts. So this script cannot dump them. The Python
 *      side has to parse the kubejs/server_scripts/*.js files for LootJS calls instead.
 *   2. dimensions.json    {dimensions:[{id, generatorClass, biomeSourceClass, biomes:[ids]}]}
 *      biome_spawns.json  {categories:[..], biomes:{<biomeId>: {dimensions:[..], creatureProbability,
 *                           spawns:{<category>:[{entity, weight, minCount, maxCount, raw}]},
 *                           spawnCosts:{<entity>:{energyBudget, charge}}}}}
 *      biome_features.json {steps:[..], biomes:{<biomeId>: {dimensions:[..], features:{<step>:[placedIds]}}}}
 *        The biome list comes from each level's chunkGenerator.getBiomeSource().possibleBiomes().
 *        Spawns and features use Forge's MODIFIED biome info (Biome.getMobSettings()/
 *        getGenerationSettings() are Forge-patched to include biome modifiers).
 *        Placed features without a registry id get the id "inline:<biome>/<step>/<n>" and
 *        are written to placed_features_inline.json.
 *   3. placed_features_<ns>.json      {placed:{<id>: {feature, json, error?}}}
 *      configured_features_<ns>.json  {configured:{<id>: {type, json, nested:[ids], blocks:[..],
 *                                       blockTags:[..], error?}}}
 *        json = codec encoding (PlacedFeature/ConfiguredFeature.DIRECT_CODEC.encodeStart with
 *        RegistryOps(JsonOps) so references come out as ids). blocks = best effort: every
 *        BlockState "Name" plus every string in the json that is a registered block id.
 *        blockTags = "tag" fields and "#..." strings. nested = ConfiguredFeature.getFeatures()
 *        (the feature itself and the sub-features it can place) mapped back to registry ids.
 *        Features that fail to encode are kept with an error and also go to _index.errors.
 *   4. knapping.json  {types:{<typeId>: {input:{ids,count}, amountToConsume, consumeAfterComplete}},
 *        recipes:[{id, knappingType, resultId, resultCount, recipeIngredientIds, typeInput:{ids,count},
 *        amountToConsume, pattern:{width, height, outsideSlotRequired, rows:["X  X", ..]}}]}
 *        For rock knapping, recipeIngredientIds holds the chosen rock. For clay/leather/goat horn
 *        it is empty and the real input is typeInput (KnappingType.inputItem()).
 *   5. barrel.json  {recipes:[{id, type, recipeClass, inputItem:{ids,count}|null,
 *        inputFluid:{ids,amount}|null, addedFluid:{ids,amount}|null, outputItem:{id,count,
 *        dependsOnInput}|null, outputFluid:{id,amount}|null, duration, infinite}]}
 *        Every BarrelRecipe subclass: InstantBarrelRecipe (tfc:barrel_instant),
 *        InstantFluidBarrelRecipe (tfc:barrel_instant_fluid, addedFluid = the fluid poured in on
 *        top) and SealedBarrelRecipe (tfc:barrel_sealed, duration in ticks, infinite = duration <= 0,
 *        i.e. no fixed time, per bytecode). outputItem.dependsOnInput=true means the output is built from the input
 *        stack (for example copy_input), so id can be null.
 *   6. heating.json {recipes:[{id, type, inputIds, resultItem:{id,count}|null,
 *        resultFluid:{id,amount}|null, temperature, chance}],
 *        metals:{<metalId>: {meltTemperature, tier, fluid, ingotIds, sheetIds}},
 *        fuels:{<fuelId>: {itemIds, temperature, duration, purity}}}
 *        Fuel's ingredient field is protected and has no getter, so itemIds come from
 *        getValidItems().
 *
 * Java API checked before writing, against javap of the srg client jar + Mojang mappings
 * (client-1.20.1-20230612.114412), DFU 6.0.8, TerraFirmaCraft-Forge-1.20.1-3.2.25,
 * lootjs-forge-1.20.1-2.13.1 and kubejs-forge-2001.6.5 (ClassFilter: com.mojang.serialization
 * and com.google.gson are not denied), plus this instance's ProbeJS typings:
 *   MinecraftServer.getLootData()/getAllLevels()/registryAccess(); LootDataManager.getKeys(
 *   LootDataType)/getElement(LootDataType, RL); LootDataType.TABLE.parser(): Gson whose
 *   LootTable$Serializer implements JsonSerializer; ServerLevel.dimension()/getChunkSource()
 *   .getGenerator().getBiomeSource().possibleBiomes(); Holder.unwrapKey()/value();
 *   Biome.getMobSettings()/getGenerationSettings(); MobSpawnSettings.getMobs(MobCategory)
 *   .unwrap(), getMobSpawnCost(), getCreatureProbability(); SpawnerData.type/minCount/maxCount/
 *   getWeight().asInt(); BiomeGenerationSettings.features(); RegistryAccess.registryOrThrow(
 *   Registries.X); Registry.entrySet()/getKey(); RegistryOps.create(DynamicOps, HolderLookup
 *   .Provider); JsonOps.INSTANCE; Codec.encodeStart -> DataResult.result()/error().message();
 *   PlacedFeature/ConfiguredFeature.DIRECT_CODEC, feature(), getFeatures(); KnappingRecipe
 *   .getKnappingType()/getPattern()/getIngredient(); KnappingType.MANAGER.getValues()/getId()/
 *   inputItem()/amountToConsume()/consumeAfterComplete(); ItemStackIngredient.ingredient()/
 *   count(); KnappingPattern.getWidth()/getHeight()/get(x, y)/isOutsideSlotRequired().
 *   v2: BarrelRecipe.getInputItem(): ItemStackIngredient, getInputFluid(): FluidStackIngredient,
 *   getOutputItem(): ItemStackProvider, getOutputFluid(): FluidStack; InstantFluidBarrelRecipe
 *   .getAddedFluid(); SealedBarrelRecipe.getDuration()/isInfinite(); FluidStackIngredient
 *   .ingredient()/amount(); FluidIngredient.fluids(); ItemStackProvider.getEmptyStack()/
 *   dependsOnInput(); HeatingRecipe.getIngredient()/getTemperature()/getChance()/
 *   getDisplayOutputFluid(), getResultItem = outputItem.getEmptyStack() (bytecode); Metal.MANAGER
 *   .getValues(), getId()/getMeltTemperature()/getTier()/getFluid()/getIngotIngredient()/
 *   getSheetIngredient(); Fuel.MANAGER.getValues(), getId()/getValidItems()/getTemperature()/
 *   getDuration()/getPurity().
 * Rhino rules followed: only var (no const/let, see S3
 * CLAUDE.md pitfall #20), no spread, no template literals, and every global has the prefix
 * ivw_ (all server_scripts share one scope, and dump_gtceu_data.js already uses ivd_).
 * Anything that could fail per entry (one loot table, one feature, one biome) is wrapped in
 * try/catch. It is logged and skipped, and the run continues.
 */

var IVW_VERSION = 5
var IVW_PRIMARY_DIR = 'kubejs/exported/item_values/world/'
var IVW_FALLBACK_DIR = 'kubejs/exported/item_values/'
var IVW_MAX_ERRORS = 5000
var IVW_LOOT_GROUPS = { blocks: true, entities: true, chests: true, gameplay: true, archaeology: true }

var ivw_state = null

function ivw_newState() {
    return {
        dir: IVW_PRIMARY_DIR,
        prefix: '',
        errors: [],
        errorCount: 0,
        startedAt: null,
        sections: {},
        blockIdSet: null,
        ops: null,
        inlinePlaced: {},
        flatRecipes: null,
        ctx: null
    }
}

function ivw_now() {
    try { return new Date().toISOString() } catch (e) { return String(Date.now()) }
}

function ivw_say(ivw_msg) {
    console.log('[itemvaluesdumpworld] ' + ivw_msg)
    try {
        if (ivw_state && ivw_state.ctx) ivw_state.ctx.source.sendSystemMessage(Text.of('[itemvaluesdumpworld] ' + ivw_msg))
    } catch (e) { }
}

function ivw_err(ivw_section, ivw_id, ivw_e) {
    ivw_state.errorCount++
    if (ivw_state.errors.length < IVW_MAX_ERRORS) {
        ivw_state.errors.push({ section: ivw_section, id: ivw_id === null || ivw_id === undefined ? null : String(ivw_id), error: String(ivw_e) })
    }
}

// Same proven write path as dump_gtceu_data.js (JsonIO.write needs a JsonObject, so obj is
// always a plain object, never an array).
function ivw_writeJson(ivw_name, ivw_obj) {
    var ivw_json = JSON.stringify(ivw_obj)
    var ivw_element = JsonIO.parseRaw(ivw_json)
    JsonIO.write(ivw_state.dir + ivw_state.prefix + ivw_name, ivw_element)
    return ivw_json.length
}

// Tries world/ first, then falls back to item_values/world_*.json (that folder is known to exist).
function ivw_initOutput() {
    ivw_state.dir = IVW_PRIMARY_DIR
    ivw_state.prefix = ''
    try {
        ivw_writeJson('_writetest.json', { ok: true, at: ivw_now() })
        return true
    } catch (e) {
        console.log('[itemvaluesdumpworld] cannot write to ' + IVW_PRIMARY_DIR + ' (' + e + '), falling back to ' + IVW_FALLBACK_DIR + 'world_*')
    }
    ivw_state.dir = IVW_FALLBACK_DIR
    ivw_state.prefix = 'world_'
    try {
        ivw_writeJson('_writetest.json', { ok: true, at: ivw_now() })
        return true
    } catch (e2) {
        console.log('[itemvaluesdumpworld] fallback write also failed: ' + e2)
        return false
    }
}

function ivw_writeIndex() {
    try {
        ivw_writeJson('_index.json', {
            version: IVW_VERSION,
            startedAt: ivw_state.startedAt,
            writtenAt: ivw_now(),
            outputDir: ivw_state.dir,
            filePrefix: ivw_state.prefix,
            sections: ivw_state.sections,
            errorCount: ivw_state.errorCount,
            errorsTruncated: ivw_state.errorCount > ivw_state.errors.length,
            errors: ivw_state.errors,
            notes: [
                'LootJS modifiers are not included: LootModificationsAPI.actions is private with no getter (javap of lootjs-forge-1.20.1-2.13.1). Parse kubejs/server_scripts for addEntityLootModifier/addBlockLootModifier/addLootTableModifier/addLootTypeModifier instead.',
                'Loot/feature json is Minecraft own serialization (loot Gson / feature codecs). drops/blocks are best-effort summaries derived from it.'
            ]
        })
    } catch (e) {
        console.log('[itemvaluesdumpworld] writing _index.json failed: ' + e)
    }
}

function ivw_safeName(ivw_s) {
    return String(ivw_s).replace(/[^a-z0-9_.\-]/gi, '_')
}

function ivw_endsWith(ivw_s, ivw_suffix) {
    ivw_s = String(ivw_s)
    return ivw_s.length >= ivw_suffix.length && ivw_s.substring(ivw_s.length - ivw_suffix.length) === ivw_suffix
}

// Gson JsonElement -> plain JS value. Falls back to the raw string if the Gson output is not
// strict JSON (for example NaN).
function ivw_jsonElToJs(ivw_el) {
    var ivw_s = String(ivw_el.toString())
    try { return JSON.parse(ivw_s) } catch (e) { return { unparsedJsonString: ivw_s } }
}

// DataResult handling: result() Optional<JsonElement>, error() Optional<PartialResult>.message().
function ivw_encode(ivw_codec, ivw_obj) {
    var ivw_res = ivw_codec.encodeStart(ivw_state.ops, ivw_obj)
    var ivw_opt = ivw_res.result()
    if (ivw_opt.isPresent()) return { ok: true, json: ivw_jsonElToJs(ivw_opt.get()) }
    var ivw_msg = 'encode failed'
    try {
        var ivw_eo = ivw_res.error()
        if (ivw_eo.isPresent()) ivw_msg = String(ivw_eo.get().message())
    } catch (e) { }
    return { ok: false, error: ivw_msg }
}

function ivw_initOps(ivw_server) {
    var ivw_JsonOps = Java.loadClass('com.mojang.serialization.JsonOps')
    try {
        var ivw_RegistryOps = Java.loadClass('net.minecraft.resources.RegistryOps')
        ivw_state.ops = ivw_RegistryOps.create(ivw_JsonOps.INSTANCE, ivw_server.registryAccess())
        return 'RegistryOps(JsonOps)'
    } catch (e) {
        console.log('[itemvaluesdumpworld] RegistryOps.create failed (' + e + '), using plain JsonOps (references get inlined)')
        ivw_state.ops = ivw_JsonOps.INSTANCE
        return 'JsonOps'
    }
}

function ivw_holderId(ivw_h) {
    try {
        var ivw_k = ivw_h.unwrapKey()
        if (ivw_k.isPresent()) return String(ivw_k.get().location())
    } catch (e) { }
    return null
}

function ivw_ingredientIds(ivw_ingredient, ivw_cap) {
    var ivw_ids = []
    try {
        for (var ivw_iid of ivw_ingredient.getItemIds()) {
            if (ivw_ids.length >= ivw_cap) break
            ivw_ids.push(String(ivw_iid))
        }
    } catch (e) { }
    return ivw_ids
}

// ---------------------------------------------------------------------------------------------
// Section 1 helpers: loot json -> flat drop summary (1.20.1 format: entries use "type",
// functions use "function", conditions use "condition").
// ---------------------------------------------------------------------------------------------
function ivw_numRange(ivw_v) {
    if (ivw_v === undefined || ivw_v === null) return null
    if (typeof ivw_v === 'number') return { min: ivw_v, max: ivw_v }
    if (typeof ivw_v === 'object') {
        var ivw_t = String(ivw_v.type || '')
        if (ivw_endsWith(ivw_t, 'constant') && typeof ivw_v.value === 'number') return { min: ivw_v.value, max: ivw_v.value }
        if (ivw_endsWith(ivw_t, 'binomial')) {
            var ivw_n = ivw_numRange(ivw_v.n)
            return { min: 0, max: ivw_n ? ivw_n.max : null, binomial: { n: ivw_v.n, p: ivw_v.p } }
        }
        if (ivw_v.min !== undefined || ivw_v.max !== undefined) {
            var ivw_lo = ivw_numRange(ivw_v.min)
            var ivw_hi = ivw_numRange(ivw_v.max)
            return { min: ivw_lo ? ivw_lo.min : null, max: ivw_hi ? ivw_hi.max : null }
        }
    }
    return { raw: ivw_v }
}

function ivw_condSummary(ivw_c) {
    var ivw_out = { type: null }
    try {
        ivw_out.type = ivw_c.condition ? String(ivw_c.condition) : null
        if (ivw_c.chance !== undefined) ivw_out.chance = ivw_c.chance
        if (ivw_c.looting_multiplier !== undefined) ivw_out.lootingMultiplier = ivw_c.looting_multiplier
        if (ivw_c.chances !== undefined) ivw_out.chances = ivw_c.chances
        if (ivw_c.enchantment !== undefined) ivw_out.enchantment = ivw_c.enchantment
        var ivw_s = JSON.stringify(ivw_c)
        if (ivw_s.indexOf('minecraft:silk_touch') >= 0) ivw_out.silkTouch = true
        if (ivw_s.indexOf('shears') >= 0) ivw_out.mentionsShears = true
        if (ivw_c.term) ivw_out.term = ivw_condSummary(ivw_c.term)
        if (Array.isArray(ivw_c.terms)) {
            ivw_out.terms = []
            for (var ivw_i = 0; ivw_i < ivw_c.terms.length; ivw_i++) ivw_out.terms.push(ivw_condSummary(ivw_c.terms[ivw_i]))
        }
        if (ivw_endsWith(ivw_out.type || '', 'inverted')) ivw_out.inverted = true
    } catch (e) { ivw_out.error = String(e) }
    return ivw_out
}

function ivw_condList(ivw_arr) {
    var ivw_out = []
    if (!Array.isArray(ivw_arr)) return ivw_out
    for (var ivw_i = 0; ivw_i < ivw_arr.length; ivw_i++) ivw_out.push(ivw_condSummary(ivw_arr[ivw_i]))
    return ivw_out
}

function ivw_walkEntry(ivw_entry, ivw_poolIdx, ivw_rolls, ivw_inherited, ivw_chain, ivw_drops) {
    if (!ivw_entry || typeof ivw_entry !== 'object') return
    var ivw_type = String(ivw_entry.type || '')
    var ivw_conds = ivw_inherited.concat(ivw_condList(ivw_entry.conditions))
    if (Array.isArray(ivw_entry.children)) {
        // chain element "<type>#<childIndex>": for minecraft:alternatives only the FIRST child
        // whose conditions pass is used, so the index matters (e.g. silk touch -> #0, else #1)
        for (var ivw_i = 0; ivw_i < ivw_entry.children.length; ivw_i++) {
            ivw_walkEntry(ivw_entry.children[ivw_i], ivw_poolIdx, ivw_rolls, ivw_conds, ivw_chain.concat([ivw_type + '#' + ivw_i]), ivw_drops)
        }
        return
    }
    var ivw_d = {
        pool: ivw_poolIdx,
        kind: ivw_type,
        id: ivw_entry.name !== undefined ? String(ivw_entry.name) : null,
        weight: ivw_entry.weight !== undefined ? ivw_entry.weight : 1,
        quality: ivw_entry.quality !== undefined ? ivw_entry.quality : 0,
        rolls: ivw_rolls,
        count: null,
        functions: [],
        conditions: ivw_conds,
        chain: ivw_chain
    }
    if (ivw_entry.expand !== undefined) ivw_d.expand = ivw_entry.expand
    var ivw_fns = ivw_entry.functions
    if (Array.isArray(ivw_fns)) {
        for (var ivw_j = 0; ivw_j < ivw_fns.length; ivw_j++) {
            var ivw_f = ivw_fns[ivw_j]
            var ivw_fname = ivw_f && ivw_f['function'] ? String(ivw_f['function']) : null
            ivw_d.functions.push(ivw_fname)
            if (ivw_fname && ivw_endsWith(ivw_fname, 'set_count')) {
                ivw_d.count = ivw_numRange(ivw_f.count)
                if (ivw_f.add) ivw_d.countAdd = true
                if (Array.isArray(ivw_f.conditions) && ivw_f.conditions.length > 0) ivw_d.countConditional = true
            }
        }
    }
    ivw_drops.push(ivw_d)
}

function ivw_lootDrops(ivw_tableJson) {
    var ivw_drops = []
    var ivw_pools = ivw_tableJson && ivw_tableJson.pools
    if (!Array.isArray(ivw_pools)) return ivw_drops
    for (var ivw_i = 0; ivw_i < ivw_pools.length; ivw_i++) {
        var ivw_pool = ivw_pools[ivw_i]
        var ivw_rolls = ivw_numRange(ivw_pool.rolls)
        var ivw_poolConds = ivw_condList(ivw_pool.conditions)
        var ivw_entries = Array.isArray(ivw_pool.entries) ? ivw_pool.entries : []
        for (var ivw_j = 0; ivw_j < ivw_entries.length; ivw_j++) {
            ivw_walkEntry(ivw_entries[ivw_j], ivw_i, ivw_rolls, ivw_poolConds, [], ivw_drops)
        }
    }
    return ivw_drops
}

// ---------------------------------------------------------------------------------------------
// Section 1: loot tables
// ---------------------------------------------------------------------------------------------
function ivw_dumpLoot(ivw_server) {
    var ivw_t0 = Date.now()
    var ivw_sec = { status: 'running', tables: 0, failed: 0, files: [] }
    ivw_state.sections.loot = ivw_sec
    var ivw_LootDataType = Java.loadClass('net.minecraft.world.level.storage.loot.LootDataType')
    var ivw_lootData = ivw_server.getLootData()
    var ivw_gson = ivw_LootDataType.TABLE.parser()

    // pass 1: bucket keys by group + namespace (cheap), so memory stays bounded per file
    var ivw_buckets = {}
    var ivw_bucketOrder = []
    for (var ivw_key of ivw_lootData.getKeys(ivw_LootDataType.TABLE)) {
        try {
            var ivw_id = String(ivw_key)
            var ivw_colon = ivw_id.indexOf(':')
            var ivw_ns = ivw_colon >= 0 ? ivw_id.substring(0, ivw_colon) : 'minecraft'
            var ivw_path = ivw_colon >= 0 ? ivw_id.substring(ivw_colon + 1) : ivw_id
            var ivw_first = ivw_path.indexOf('/') >= 0 ? ivw_path.substring(0, ivw_path.indexOf('/')) : ''
            var ivw_group = IVW_LOOT_GROUPS[ivw_first] ? ivw_first : 'other'
            var ivw_bk = ivw_group + '_' + ivw_safeName(ivw_ns)
            if (!ivw_buckets[ivw_bk]) {
                ivw_buckets[ivw_bk] = { group: ivw_group, ns: ivw_ns, keys: [] }
                ivw_bucketOrder.push(ivw_bk)
            }
            ivw_buckets[ivw_bk].keys.push(ivw_key)
        } catch (e) { ivw_err('loot', ivw_key, e) }
    }
    ivw_say('loot: ' + ivw_bucketOrder.length + ' files to write')

    var ivw_index = {}
    for (var ivw_b = 0; ivw_b < ivw_bucketOrder.length; ivw_b++) {
        var ivw_bucket = ivw_buckets[ivw_bucketOrder[ivw_b]]
        var ivw_fileName = 'loot_' + ivw_bucketOrder[ivw_b] + '.json'
        var ivw_tables = []
        for (var ivw_k = 0; ivw_k < ivw_bucket.keys.length; ivw_k++) {
            var ivw_rl = ivw_bucket.keys[ivw_k]
            var ivw_tid = String(ivw_rl)
            var ivw_entry = { id: ivw_tid, json: null, drops: [] }
            var ivw_idx = { file: ivw_state.prefix + ivw_fileName, group: ivw_bucket.group, items: [], tags: [], refs: [] }
            try {
                var ivw_table = null
                try { ivw_table = ivw_lootData.getElement(ivw_LootDataType.TABLE, ivw_rl) } catch (e1) { ivw_table = ivw_lootData.getLootTable(ivw_rl) }
                if (ivw_table === null || ivw_table === undefined) throw 'table is null'
                ivw_entry.json = ivw_jsonElToJs(ivw_gson.toJsonTree(ivw_table))
                try {
                    ivw_entry.drops = ivw_lootDrops(ivw_entry.json)
                    var ivw_seen = {}
                    for (var ivw_d = 0; ivw_d < ivw_entry.drops.length; ivw_d++) {
                        var ivw_dr = ivw_entry.drops[ivw_d]
                        if (!ivw_dr.id || ivw_seen[ivw_dr.kind + '|' + ivw_dr.id]) continue
                        ivw_seen[ivw_dr.kind + '|' + ivw_dr.id] = true
                        if (ivw_endsWith(ivw_dr.kind, ':item')) ivw_idx.items.push(ivw_dr.id)
                        else if (ivw_endsWith(ivw_dr.kind, ':tag')) ivw_idx.tags.push(ivw_dr.id)
                        else if (ivw_endsWith(ivw_dr.kind, ':loot_table')) ivw_idx.refs.push(ivw_dr.id)
                    }
                } catch (e2) {
                    ivw_entry.dropsError = String(e2)
                    ivw_err('loot-drops', ivw_tid, e2)
                }
                ivw_sec.tables++
            } catch (e) {
                ivw_entry.error = String(e)
                ivw_idx.error = String(e)
                ivw_sec.failed++
                ivw_err('loot', ivw_tid, e)
            }
            ivw_tables.push(ivw_entry)
            ivw_index[ivw_tid] = ivw_idx
        }
        try {
            var ivw_bytes = ivw_writeJson(ivw_fileName, { group: ivw_bucket.group, namespace: ivw_bucket.ns, tables: ivw_tables })
            ivw_sec.files.push(ivw_state.prefix + ivw_fileName)
            console.log('[itemvaluesdumpworld] ' + ivw_fileName + ': ' + ivw_tables.length + ' tables, ' + ivw_bytes + ' bytes')
        } catch (e) {
            ivw_err('loot-write', ivw_fileName, e)
        }
    }
    try {
        ivw_writeJson('loot_index.json', {
            lootjsNote: 'LootJS modifiers are NOT included (no public API to read them, see file header). Parse kubejs/server_scripts for them.',
            tables: ivw_index
        })
        ivw_sec.files.push(ivw_state.prefix + 'loot_index.json')
    } catch (e) { ivw_err('loot-write', 'loot_index.json', e) }
    ivw_sec.status = 'done'
    ivw_sec.ms = Date.now() - ivw_t0
    ivw_say('loot: ' + ivw_sec.tables + ' tables ok, ' + ivw_sec.failed + ' failed (' + ivw_sec.ms + ' ms)')
}

// ---------------------------------------------------------------------------------------------
// Section 2: dimensions, biome spawns, per-biome placed feature lists
// ---------------------------------------------------------------------------------------------
function ivw_dumpBiomes(ivw_server) {
    var ivw_t0 = Date.now()
    var ivw_sec = { status: 'running', dimensions: 0, biomes: 0, spawnEntries: 0, failed: 0, files: [] }
    ivw_state.sections.biomes = ivw_sec
    var ivw_ForgeRegistries = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
    var ivw_MobCategory = Java.loadClass('net.minecraft.world.entity.MobCategory')
    var ivw_Decoration = Java.loadClass('net.minecraft.world.level.levelgen.GenerationStep$Decoration')

    var ivw_dims = []
    var ivw_biomeDims = {}
    var ivw_biomeObjs = {}
    var ivw_biomeOrder = []
    for (var ivw_level of ivw_server.getAllLevels()) {
        var ivw_dim = { id: null, generatorClass: null, biomeSourceClass: null, biomes: [] }
        try {
            // KubeJS shadows ServerLevel.dimension() with its own `dimension` bean property
            // (a ResourceLocation) - calling it failed in v2 ("It is not a function").
            // Accept both shapes: function -> ResourceKey, property -> ResourceKey or ResourceLocation.
            var ivw_dk = ivw_level.dimension
            if (typeof ivw_dk === 'function') ivw_dk = ivw_level.dimension()
            var ivw_dloc = null
            try { ivw_dloc = ivw_dk.location() } catch (e) { ivw_dloc = ivw_dk }
            ivw_dim.id = String(ivw_dloc)
            var ivw_gen = ivw_level.getChunkSource().getGenerator()
            try { ivw_dim.generatorClass = String(ivw_gen.getClass().getName()) } catch (e) { }
            var ivw_bs = ivw_gen.getBiomeSource()
            try { ivw_dim.biomeSourceClass = String(ivw_bs.getClass().getName()) } catch (e) { }
            var ivw_n = 0
            for (var ivw_holder of ivw_bs.possibleBiomes()) {
                ivw_n++
                try {
                    var ivw_bid = ivw_holderId(ivw_holder)
                    if (!ivw_bid) ivw_bid = 'unregistered:' + ivw_dim.id + '/' + ivw_n
                    ivw_dim.biomes.push(ivw_bid)
                    if (!ivw_biomeDims[ivw_bid]) {
                        ivw_biomeDims[ivw_bid] = []
                        ivw_biomeObjs[ivw_bid] = ivw_holder.value()
                        ivw_biomeOrder.push(ivw_bid)
                    }
                    if (ivw_biomeDims[ivw_bid].indexOf(ivw_dim.id) < 0) ivw_biomeDims[ivw_bid].push(ivw_dim.id)
                } catch (e) { ivw_err('biomes-dim', ivw_dim.id, e) }
            }
            ivw_sec.dimensions++
        } catch (e) {
            ivw_dim.error = String(e)
            ivw_err('biomes-dim', ivw_dim.id, e)
        }
        ivw_dims.push(ivw_dim)
    }
    try {
        ivw_writeJson('dimensions.json', { dimensions: ivw_dims })
        ivw_sec.files.push(ivw_state.prefix + 'dimensions.json')
    } catch (e) { ivw_err('biomes-write', 'dimensions.json', e) }
    ivw_say('biomes: ' + ivw_dims.length + ' dimensions, ' + ivw_biomeOrder.length + ' distinct biomes')

    var ivw_categories = []
    var ivw_catObjs = []
    for (var ivw_cat of ivw_MobCategory.values()) {
        var ivw_cname = null
        try { ivw_cname = String(ivw_cat.getName()) } catch (e) { ivw_cname = String(ivw_cat) }
        ivw_categories.push(ivw_cname)
        ivw_catObjs.push(ivw_cat)
    }
    var ivw_steps = []
    var ivw_decos = ivw_Decoration.values()
    for (var ivw_si = 0; ivw_si < ivw_decos.length; ivw_si++) {
        var ivw_sname = null
        try { ivw_sname = String(ivw_decos[ivw_si].getName()) } catch (e) { ivw_sname = String(ivw_decos[ivw_si]) }
        ivw_steps.push(ivw_sname)
    }

    var ivw_spawnOut = {}
    var ivw_featOut = {}
    for (var ivw_b = 0; ivw_b < ivw_biomeOrder.length; ivw_b++) {
        var ivw_biomeId = ivw_biomeOrder[ivw_b]
        var ivw_biome = ivw_biomeObjs[ivw_biomeId]
        // spawns
        var ivw_sp = { dimensions: ivw_biomeDims[ivw_biomeId], creatureProbability: null, spawns: {}, spawnCosts: {} }
        try {
            var ivw_mob = ivw_biome.getMobSettings()
            try { ivw_sp.creatureProbability = ivw_mob.getCreatureProbability() } catch (e) { }
            for (var ivw_c = 0; ivw_c < ivw_catObjs.length; ivw_c++) {
                var ivw_list = []
                try {
                    for (var ivw_sd of ivw_mob.getMobs(ivw_catObjs[ivw_c]).unwrap()) {
                        var ivw_row = { entity: null, weight: null, minCount: null, maxCount: null, raw: null }
                        try { ivw_row.raw = String(ivw_sd) } catch (e) { }
                        try { ivw_row.entity = String(ivw_ForgeRegistries.ENTITY_TYPES.getKey(ivw_sd.type)) } catch (e) { }
                        try { ivw_row.weight = ivw_sd.getWeight().asInt() } catch (e) { }
                        try { ivw_row.minCount = ivw_sd.minCount } catch (e) { }
                        try { ivw_row.maxCount = ivw_sd.maxCount } catch (e) { }
                        try {
                            if (ivw_row.entity && !ivw_sp.spawnCosts[ivw_row.entity]) {
                                var ivw_cost = ivw_mob.getMobSpawnCost(ivw_sd.type)
                                if (ivw_cost) ivw_sp.spawnCosts[ivw_row.entity] = { energyBudget: ivw_cost.energyBudget(), charge: ivw_cost.charge() }
                            }
                        } catch (e) { }
                        ivw_list.push(ivw_row)
                        ivw_sec.spawnEntries++
                    }
                } catch (e) { ivw_err('biomes-spawns', ivw_biomeId + ' ' + ivw_categories[ivw_c], e) }
                if (ivw_list.length > 0) ivw_sp.spawns[ivw_categories[ivw_c]] = ivw_list
            }
        } catch (e) {
            ivw_sp.error = String(e)
            ivw_sec.failed++
            ivw_err('biomes-spawns', ivw_biomeId, e)
        }
        ivw_spawnOut[ivw_biomeId] = ivw_sp

        // placed features per generation step
        var ivw_bf = { dimensions: ivw_biomeDims[ivw_biomeId], features: {} }
        try {
            var ivw_stepLists = ivw_biome.getGenerationSettings().features()
            for (var ivw_s = 0; ivw_s < ivw_stepLists.size(); ivw_s++) {
                var ivw_stepName = ivw_s < ivw_steps.length ? ivw_steps[ivw_s] : ('step_' + ivw_s)
                var ivw_ids = []
                try {
                    var ivw_m = 0
                    for (var ivw_ph of ivw_stepLists.get(ivw_s)) {
                        ivw_m++
                        var ivw_pid = ivw_holderId(ivw_ph)
                        if (!ivw_pid) {
                            ivw_pid = 'inline:' + ivw_biomeId + '/' + ivw_stepName + '/' + ivw_m
                            ivw_state.inlinePlaced[ivw_pid] = ivw_ph
                        }
                        ivw_ids.push(ivw_pid)
                    }
                } catch (e) { ivw_err('biomes-features', ivw_biomeId + ' ' + ivw_stepName, e) }
                ivw_bf.features[ivw_stepName] = ivw_ids
            }
        } catch (e) {
            ivw_bf.error = String(e)
            ivw_err('biomes-features', ivw_biomeId, e)
        }
        ivw_featOut[ivw_biomeId] = ivw_bf
        ivw_sec.biomes++
    }
    try {
        ivw_writeJson('biome_spawns.json', { categories: ivw_categories, biomes: ivw_spawnOut })
        ivw_sec.files.push(ivw_state.prefix + 'biome_spawns.json')
    } catch (e) { ivw_err('biomes-write', 'biome_spawns.json', e) }
    try {
        ivw_writeJson('biome_features.json', { steps: ivw_steps, biomes: ivw_featOut })
        ivw_sec.files.push(ivw_state.prefix + 'biome_features.json')
    } catch (e) { ivw_err('biomes-write', 'biome_features.json', e) }
    ivw_sec.status = 'done'
    ivw_sec.ms = Date.now() - ivw_t0
    ivw_say('biomes: ' + ivw_sec.biomes + ' biomes, ' + ivw_sec.spawnEntries + ' spawn entries, ' + ivw_sec.failed + ' failed (' + ivw_sec.ms + ' ms)')
}

// ---------------------------------------------------------------------------------------------
// Section 3: placed + configured feature registries (codec JSON) and best-effort block lists
// ---------------------------------------------------------------------------------------------
function ivw_buildBlockIdSet() {
    if (ivw_state.blockIdSet) return ivw_state.blockIdSet
    var ivw_set = {}
    try {
        var ivw_FR = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
        for (var ivw_k of ivw_FR.BLOCKS.getKeys()) ivw_set[String(ivw_k)] = true
    } catch (e) { ivw_err('features', 'block id set', e) }
    delete ivw_set['minecraft:air']
    ivw_state.blockIdSet = ivw_set
    return ivw_set
}

function ivw_collectBlocks(ivw_v, ivw_key, ivw_blockSet, ivw_blocks, ivw_tags, ivw_depth) {
    if (ivw_depth > 200 || ivw_v === null || ivw_v === undefined) return
    if (typeof ivw_v === 'string') {
        if (ivw_blockSet[ivw_v]) ivw_blocks[ivw_v] = true
        else if (ivw_v.charAt(0) === '#') ivw_tags[ivw_v.substring(1)] = true
        else if (ivw_key === 'tag' && ivw_v.indexOf(':') > 0) ivw_tags[ivw_v] = true
        return
    }
    if (typeof ivw_v !== 'object') return
    if (Array.isArray(ivw_v)) {
        for (var ivw_i = 0; ivw_i < ivw_v.length; ivw_i++) ivw_collectBlocks(ivw_v[ivw_i], ivw_key, ivw_blockSet, ivw_blocks, ivw_tags, ivw_depth + 1)
        return
    }
    if (typeof ivw_v.Name === 'string' && ivw_v.Name !== 'minecraft:air') ivw_blocks[ivw_v.Name] = true
    for (var ivw_k in ivw_v) {
        ivw_collectBlocks(ivw_v[ivw_k], ivw_k, ivw_blockSet, ivw_blocks, ivw_tags, ivw_depth + 1)
    }
}

function ivw_nsOf(ivw_id) {
    var ivw_c = ivw_id.indexOf(':')
    return ivw_c >= 0 ? ivw_id.substring(0, ivw_c) : 'minecraft'
}

function ivw_dumpFeatures(ivw_server) {
    var ivw_t0 = Date.now()
    var ivw_sec = { status: 'running', placed: 0, placedFailed: 0, configured: 0, configuredFailed: 0, inlinePlaced: 0, files: [] }
    ivw_state.sections.features = ivw_sec
    var ivw_Registries = Java.loadClass('net.minecraft.core.registries.Registries')
    var ivw_PlacedFeature = Java.loadClass('net.minecraft.world.level.levelgen.placement.PlacedFeature')
    var ivw_ConfiguredFeature = Java.loadClass('net.minecraft.world.level.levelgen.feature.ConfiguredFeature')
    var ivw_FR = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
    var ivw_ra = ivw_server.registryAccess()
    var ivw_blockSet = ivw_buildBlockIdSet()
    var ivw_cfReg = ivw_ra.registryOrThrow(ivw_Registries.CONFIGURED_FEATURE)
    var ivw_pfReg = ivw_ra.registryOrThrow(ivw_Registries.PLACED_FEATURE)

    function ivw_placedEntry(ivw_pf, ivw_pidForErr) {
        var ivw_e = { feature: null, json: null }
        try {
            ivw_e.feature = ivw_holderId(ivw_pf.feature())
            if (!ivw_e.feature) {
                ivw_e.feature = 'inline'
                try {
                    var ivw_inl = ivw_encode(ivw_ConfiguredFeature.DIRECT_CODEC, ivw_pf.feature().value())
                    ivw_e.inlineFeature = ivw_inl.ok ? ivw_inl.json : null
                    if (!ivw_inl.ok) ivw_e.inlineFeatureError = ivw_inl.error
                } catch (e2) { ivw_e.inlineFeatureError = String(e2) }
            }
            var ivw_enc = ivw_encode(ivw_PlacedFeature.DIRECT_CODEC, ivw_pf)
            if (ivw_enc.ok) {
                ivw_e.json = ivw_enc.json
                ivw_sec.placed++
            } else {
                ivw_e.error = ivw_enc.error
                ivw_sec.placedFailed++
                ivw_err('features-placed', ivw_pidForErr, ivw_enc.error)
            }
        } catch (e) {
            ivw_e.error = String(e)
            ivw_sec.placedFailed++
            ivw_err('features-placed', ivw_pidForErr, e)
        }
        return ivw_e
    }

    // placed features (registry), bucketed by namespace
    var ivw_pBuckets = {}
    var ivw_pOrder = []
    for (var ivw_pe of ivw_pfReg.entrySet()) {
        try {
            var ivw_pid = String(ivw_pe.getKey().location())
            var ivw_pns = ivw_safeName(ivw_nsOf(ivw_pid))
            if (!ivw_pBuckets[ivw_pns]) { ivw_pBuckets[ivw_pns] = []; ivw_pOrder.push(ivw_pns) }
            ivw_pBuckets[ivw_pns].push({ id: ivw_pid, obj: ivw_pe.getValue() })
        } catch (e) { ivw_err('features-placed', null, e) }
    }
    for (var ivw_pb = 0; ivw_pb < ivw_pOrder.length; ivw_pb++) {
        var ivw_pOut = {}
        var ivw_plist = ivw_pBuckets[ivw_pOrder[ivw_pb]]
        for (var ivw_pi = 0; ivw_pi < ivw_plist.length; ivw_pi++) {
            ivw_pOut[ivw_plist[ivw_pi].id] = ivw_placedEntry(ivw_plist[ivw_pi].obj, ivw_plist[ivw_pi].id)
        }
        var ivw_pfile = 'placed_features_' + ivw_pOrder[ivw_pb] + '.json'
        try {
            ivw_writeJson(ivw_pfile, { placed: ivw_pOut })
            ivw_sec.files.push(ivw_state.prefix + ivw_pfile)
        } catch (e) { ivw_err('features-write', ivw_pfile, e) }
    }
    // inline placed features found while walking biomes (only if the biomes section ran first)
    var ivw_inlOut = {}
    for (var ivw_ik in ivw_state.inlinePlaced) {
        try {
            ivw_inlOut[ivw_ik] = ivw_placedEntry(ivw_state.inlinePlaced[ivw_ik].value(), ivw_ik)
            ivw_sec.inlinePlaced++
        } catch (e) { ivw_err('features-inline', ivw_ik, e) }
    }
    try {
        ivw_writeJson('placed_features_inline.json', { placed: ivw_inlOut })
        ivw_sec.files.push(ivw_state.prefix + 'placed_features_inline.json')
    } catch (e) { ivw_err('features-write', 'placed_features_inline.json', e) }
    ivw_say('features: ' + ivw_sec.placed + ' placed features ok, ' + ivw_sec.placedFailed + ' failed')

    // configured features (registry), bucketed by namespace
    var ivw_cBuckets = {}
    var ivw_cOrder = []
    for (var ivw_ce of ivw_cfReg.entrySet()) {
        try {
            var ivw_cid = String(ivw_ce.getKey().location())
            var ivw_cns = ivw_safeName(ivw_nsOf(ivw_cid))
            if (!ivw_cBuckets[ivw_cns]) { ivw_cBuckets[ivw_cns] = []; ivw_cOrder.push(ivw_cns) }
            ivw_cBuckets[ivw_cns].push({ id: ivw_cid, obj: ivw_ce.getValue() })
        } catch (e) { ivw_err('features-configured', null, e) }
    }
    for (var ivw_cb = 0; ivw_cb < ivw_cOrder.length; ivw_cb++) {
        var ivw_cOut = {}
        var ivw_clist = ivw_cBuckets[ivw_cOrder[ivw_cb]]
        for (var ivw_ci = 0; ivw_ci < ivw_clist.length; ivw_ci++) {
            var ivw_cfId = ivw_clist[ivw_ci].id
            var ivw_cf = ivw_clist[ivw_ci].obj
            var ivw_ent = { type: null, json: null, nested: [], blocks: [], blockTags: [] }
            try {
                try { ivw_ent.type = String(ivw_FR.FEATURES.getKey(ivw_cf.feature())) } catch (e) { }
                try {
                    var ivw_it = ivw_cf.getFeatures().iterator()
                    var ivw_guard = 0
                    while (ivw_it.hasNext() && ivw_guard < 1000) {
                        ivw_guard++
                        var ivw_nf = ivw_it.next()
                        var ivw_nk = null
                        try { ivw_nk = ivw_cfReg.getKey(ivw_nf) } catch (e) { }
                        var ivw_nid = ivw_nk ? String(ivw_nk) : 'inline'
                        if (ivw_nid !== ivw_cfId && ivw_ent.nested.indexOf(ivw_nid) < 0) ivw_ent.nested.push(ivw_nid)
                    }
                } catch (e) { ivw_ent.nestedError = String(e) }
                var ivw_cenc = ivw_encode(ivw_ConfiguredFeature.DIRECT_CODEC, ivw_cf)
                if (ivw_cenc.ok) {
                    ivw_ent.json = ivw_cenc.json
                    try {
                        var ivw_blocks = {}
                        var ivw_tags = {}
                        ivw_collectBlocks(ivw_ent.json, null, ivw_blockSet, ivw_blocks, ivw_tags, 0)
                        ivw_ent.blocks = Object.keys(ivw_blocks)
                        ivw_ent.blockTags = Object.keys(ivw_tags)
                    } catch (e) { ivw_ent.blocksError = String(e) }
                    ivw_sec.configured++
                } else {
                    ivw_ent.error = ivw_cenc.error
                    ivw_sec.configuredFailed++
                    ivw_err('features-configured', ivw_cfId, ivw_cenc.error)
                }
            } catch (e) {
                ivw_ent.error = String(e)
                ivw_sec.configuredFailed++
                ivw_err('features-configured', ivw_cfId, e)
            }
            ivw_cOut[ivw_cfId] = ivw_ent
        }
        var ivw_cfile = 'configured_features_' + ivw_cOrder[ivw_cb] + '.json'
        try {
            var ivw_cbytes = ivw_writeJson(ivw_cfile, { configured: ivw_cOut })
            ivw_sec.files.push(ivw_state.prefix + ivw_cfile)
            console.log('[itemvaluesdumpworld] ' + ivw_cfile + ': ' + ivw_clist.length + ' features, ' + ivw_cbytes + ' bytes')
        } catch (e) { ivw_err('features-write', ivw_cfile, e) }
    }
    ivw_sec.status = 'done'
    ivw_sec.ms = Date.now() - ivw_t0
    ivw_say('features: ' + ivw_sec.configured + ' configured features ok, ' + ivw_sec.configuredFailed + ' failed (' + ivw_sec.ms + ' ms)')
}

// ---------------------------------------------------------------------------------------------
// Section 4: TFC knapping recipes + knapping types
// ---------------------------------------------------------------------------------------------
function ivw_dumpKnapping(ivw_ctx) {
    var ivw_t0 = Date.now()
    var ivw_sec = { status: 'running', recipes: 0, failed: 0, types: 0, files: [] }
    ivw_state.sections.knapping = ivw_sec
    var ivw_types = {}
    try {
        var ivw_KnappingType = Java.loadClass('net.dries007.tfc.util.KnappingType')
        for (var ivw_kt of ivw_KnappingType.MANAGER.getValues()) {
            var ivw_ktId = null
            try {
                ivw_ktId = String(ivw_kt.getId())
                var ivw_te = { input: { ids: [], count: null }, amountToConsume: null, consumeAfterComplete: null }
                try {
                    var ivw_tin = ivw_kt.inputItem()
                    ivw_te.input.ids = ivw_ingredientIds(ivw_tin.ingredient(), 256)
                    ivw_te.input.count = ivw_tin.count()
                } catch (e) { ivw_te.inputError = String(e) }
                try { ivw_te.amountToConsume = ivw_kt.amountToConsume() } catch (e) { }
                try { ivw_te.consumeAfterComplete = ivw_kt.consumeAfterComplete() } catch (e) { }
                ivw_types[ivw_ktId] = ivw_te
                ivw_sec.types++
            } catch (e) { ivw_err('knapping-type', ivw_ktId, e) }
        }
    } catch (e) { ivw_err('knapping-type', null, e) }

    var ivw_level = ivw_ctx.source.getLevel()
    var ivw_registryAccess = ivw_level.registryAccess()
    var ivw_flat = ivw_flatRecipes(ivw_level)

    var ivw_recipes = []
    for (var ivw_i = 0; ivw_i < ivw_flat.length; ivw_i++) {
        var ivw_r = ivw_flat[ivw_i]
        var ivw_cls = null
        try { ivw_cls = String(ivw_r.getClass().getSimpleName()) } catch (e) { continue }
        if (ivw_cls !== 'KnappingRecipe') continue
        var ivw_e = { id: null, recipeType: null, knappingType: null, resultId: null, resultCount: null, recipeIngredientIds: [], typeInput: { ids: [], count: null }, amountToConsume: null, pattern: null }
        try {
            try { ivw_e.id = String(ivw_r.getId()) } catch (e) { }
            try { ivw_e.recipeType = String(ivw_r.getType()) } catch (e) { }
            try {
                var ivw_res = ivw_r.getResultItem(ivw_registryAccess)
                if (ivw_res && !ivw_res.isEmpty()) {
                    ivw_e.resultId = String(ivw_res.getId())
                    ivw_e.resultCount = ivw_res.getCount()
                }
            } catch (e) { ivw_e.resultError = String(e) }
            try { ivw_e.recipeIngredientIds = ivw_ingredientIds(ivw_r.getIngredient(), 256) } catch (e) { }
            try {
                var ivw_kt2 = ivw_r.getKnappingType()
                ivw_e.knappingType = String(ivw_kt2.getId())
                try { ivw_e.amountToConsume = ivw_kt2.amountToConsume() } catch (e) { }
                try {
                    var ivw_tin2 = ivw_kt2.inputItem()
                    ivw_e.typeInput.ids = ivw_ingredientIds(ivw_tin2.ingredient(), 256)
                    ivw_e.typeInput.count = ivw_tin2.count()
                } catch (e) { }
            } catch (e) { ivw_e.knappingTypeError = String(e) }
            try {
                var ivw_p = ivw_r.getPattern()
                var ivw_w = ivw_p.getWidth()
                var ivw_h = ivw_p.getHeight()
                var ivw_rows = []
                for (var ivw_y = 0; ivw_y < ivw_h; ivw_y++) {
                    var ivw_line = ''
                    for (var ivw_x = 0; ivw_x < ivw_w; ivw_x++) ivw_line += ivw_p.get(ivw_x, ivw_y) ? 'X' : ' '
                    ivw_rows.push(ivw_line)
                }
                ivw_e.pattern = { width: ivw_w, height: ivw_h, outsideSlotRequired: ivw_p.isOutsideSlotRequired(), rows: ivw_rows }
            } catch (e) { ivw_e.patternError = String(e) }
            ivw_sec.recipes++
        } catch (e) {
            ivw_e.error = String(e)
            ivw_sec.failed++
            ivw_err('knapping', ivw_e.id, e)
        }
        ivw_recipes.push(ivw_e)
    }
    try {
        ivw_writeJson('knapping.json', { types: ivw_types, recipes: ivw_recipes })
        ivw_sec.files.push(ivw_state.prefix + 'knapping.json')
    } catch (e) { ivw_err('knapping-write', 'knapping.json', e) }
    ivw_sec.status = 'done'
    ivw_sec.ms = Date.now() - ivw_t0
    ivw_say('knapping: ' + ivw_sec.types + ' types, ' + ivw_sec.recipes + ' recipes, ' + ivw_sec.failed + ' failed (' + ivw_sec.ms + ' ms)')
}

// ---------------------------------------------------------------------------------------------
// Shared helpers for sections 5/6
// ---------------------------------------------------------------------------------------------
// Same duck-typed flatten as dump_gtceu_data.js (getRecipes() is a nested map here). Cached per run.
function ivw_flatRecipes(ivw_level) {
    if (ivw_state.flatRecipes) return ivw_state.flatRecipes
    var ivw_raw = ivw_level.getRecipeManager().getRecipes()
    var ivw_flat = []
    var ivw_isMap = false
    try { ivw_raw.entrySet(); ivw_isMap = true } catch (e) { ivw_isMap = false }
    if (ivw_isMap) {
        for (var ivw_outer of ivw_raw.entrySet()) {
            var ivw_inner = ivw_outer.getValue()
            try {
                for (var ivw_ie of ivw_inner.entrySet()) ivw_flat.push(ivw_ie.getValue())
            } catch (e) { ivw_flat.push(ivw_inner) }
        }
    } else {
        for (var ivw_direct of ivw_raw) ivw_flat.push(ivw_direct)
    }
    ivw_state.flatRecipes = ivw_flat
    return ivw_flat
}

function ivw_fluidId(ivw_fluid) {
    try { return String(ivw_fluid.builtInRegistryHolder().key().location()) } catch (e) { return null }
}

// Forge FluidStack -> {id, amount} or null if empty
function ivw_fluidStack(ivw_fs) {
    if (ivw_fs === null || ivw_fs === undefined) return null
    try { if (ivw_fs.isEmpty()) return null } catch (e) { }
    return { id: ivw_fluidId(ivw_fs.getFluid()), amount: ivw_fs.getAmount() }
}

// TFC FluidStackIngredient -> {ids, amount} (FluidIngredient.fluids(), proven in dump_gtceu_data.js)
function ivw_fluidIngredient(ivw_fsi) {
    if (ivw_fsi === null || ivw_fsi === undefined) return null
    var ivw_out = { ids: [], amount: null }
    try { ivw_out.amount = ivw_fsi.amount() } catch (e) { }
    try {
        for (var ivw_f of ivw_fsi.ingredient().fluids()) {
            if (ivw_out.ids.length >= 64) break
            var ivw_fid = ivw_fluidId(ivw_f)
            if (ivw_fid) ivw_out.ids.push(ivw_fid)
        }
    } catch (e) { ivw_out.error = String(e) }
    if (ivw_out.ids.length === 0 && !ivw_out.amount) return null
    return ivw_out
}

// TFC ItemStackIngredient -> {ids, count}
function ivw_itemStackIngredient(ivw_isi) {
    if (ivw_isi === null || ivw_isi === undefined) return null
    var ivw_out = { ids: [], count: null }
    try { ivw_out.ids = ivw_ingredientIds(ivw_isi.ingredient(), 256) } catch (e) { }
    try { ivw_out.count = ivw_isi.count() } catch (e) { }
    if (ivw_out.ids.length === 0) return null
    return ivw_out
}

// TFC ItemStackProvider -> {id, count, dependsOnInput} or null if it produces nothing
function ivw_stackProvider(ivw_p) {
    if (ivw_p === null || ivw_p === undefined) return null
    var ivw_out = { id: null, count: null, dependsOnInput: null }
    try { ivw_out.dependsOnInput = ivw_p.dependsOnInput() } catch (e) { }
    try {
        var ivw_st = ivw_p.getEmptyStack()
        if (ivw_st && !ivw_st.isEmpty()) {
            ivw_out.id = String(ivw_st.getId())
            ivw_out.count = ivw_st.getCount()
        }
    } catch (e) { ivw_out.error = String(e) }
    if (!ivw_out.id && !ivw_out.dependsOnInput) return null
    return ivw_out
}

function ivw_itemIds(ivw_items, ivw_cap) {
    var ivw_ids = []
    try {
        var ivw_FR = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
        for (var ivw_it of ivw_items) {
            if (ivw_ids.length >= ivw_cap) break
            try {
                var ivw_k = ivw_FR.ITEMS.getKey(ivw_it)
                if (ivw_k) ivw_ids.push(String(ivw_k))
            } catch (e2) { }
        }
    } catch (e) { }
    return ivw_ids
}

// ---------------------------------------------------------------------------------------------
// Section 5: TFC barrel recipes (BarrelRecipe base: InstantBarrelRecipe, InstantFluidBarrelRecipe,
// SealedBarrelRecipe)
// ---------------------------------------------------------------------------------------------
function ivw_dumpBarrel(ivw_ctx) {
    var ivw_t0 = Date.now()
    var ivw_sec = { status: 'running', recipes: 0, failed: 0, byClass: {}, files: [] }
    ivw_state.sections.barrel = ivw_sec
    var ivw_BarrelRecipe = null
    try { ivw_BarrelRecipe = Java.loadClass('net.dries007.tfc.common.recipes.BarrelRecipe') } catch (e) { ivw_err('barrel', 'loadClass BarrelRecipe', e) }
    var ivw_level = ivw_ctx.source.getLevel()
    var ivw_flat = ivw_flatRecipes(ivw_level)
    var ivw_recipes = []
    for (var ivw_i = 0; ivw_i < ivw_flat.length; ivw_i++) {
        var ivw_r = ivw_flat[ivw_i]
        var ivw_cls = null
        var ivw_type = null
        try { ivw_cls = String(ivw_r.getClass().getSimpleName()) } catch (e) { continue }
        try { ivw_type = String(ivw_r.getType()) } catch (e) { }
        var ivw_isBarrel = false
        try { if (ivw_BarrelRecipe !== null && ivw_r instanceof ivw_BarrelRecipe) ivw_isBarrel = true } catch (e) { }
        if (!ivw_isBarrel && ivw_type && ivw_type.indexOf('tfc:barrel_') === 0) ivw_isBarrel = true
        if (!ivw_isBarrel) continue
        var ivw_e = { id: null, type: ivw_type, recipeClass: ivw_cls, inputItem: null, inputFluid: null, addedFluid: null, outputItem: null, outputFluid: null, duration: null, infinite: null }
        try {
            try { ivw_e.id = String(ivw_r.getId()) } catch (e) { }
            try { ivw_e.inputItem = ivw_itemStackIngredient(ivw_r.getInputItem()) } catch (e) { ivw_e.inputItemError = String(e) }
            try { ivw_e.inputFluid = ivw_fluidIngredient(ivw_r.getInputFluid()) } catch (e) { ivw_e.inputFluidError = String(e) }
            try { ivw_e.outputItem = ivw_stackProvider(ivw_r.getOutputItem()) } catch (e) { ivw_e.outputItemError = String(e) }
            try { ivw_e.outputFluid = ivw_fluidStack(ivw_r.getOutputFluid()) } catch (e) { ivw_e.outputFluidError = String(e) }
            if (ivw_cls === 'InstantFluidBarrelRecipe') {
                // the second fluid poured in (from a held fluid container) on top of the barrel's fluid
                try { ivw_e.addedFluid = ivw_fluidIngredient(ivw_r.getAddedFluid()) } catch (e) { ivw_e.addedFluidError = String(e) }
            }
            if (ivw_cls === 'SealedBarrelRecipe') {
                try { ivw_e.duration = ivw_r.getDuration() } catch (e) { }
                try { ivw_e.infinite = ivw_r.isInfinite() } catch (e) { }
            }
            ivw_sec.recipes++
            ivw_sec.byClass[ivw_cls] = (ivw_sec.byClass[ivw_cls] || 0) + 1
        } catch (e) {
            ivw_e.error = String(e)
            ivw_sec.failed++
            ivw_err('barrel', ivw_e.id, e)
        }
        ivw_recipes.push(ivw_e)
    }
    try {
        ivw_writeJson('barrel.json', { recipes: ivw_recipes })
        ivw_sec.files.push(ivw_state.prefix + 'barrel.json')
    } catch (e) { ivw_err('barrel-write', 'barrel.json', e) }
    ivw_sec.status = 'done'
    ivw_sec.ms = Date.now() - ivw_t0
    ivw_say('barrel: ' + ivw_sec.recipes + ' recipes, ' + ivw_sec.failed + ' failed (' + ivw_sec.ms + ' ms)')
}

// ---------------------------------------------------------------------------------------------
// Section 6: TFC heating recipes + metals + fuels
// ---------------------------------------------------------------------------------------------
function ivw_dumpHeating(ivw_ctx) {
    var ivw_t0 = Date.now()
    var ivw_sec = { status: 'running', recipes: 0, failed: 0, metals: 0, fuels: 0, files: [] }
    ivw_state.sections.heating = ivw_sec
    var ivw_level = ivw_ctx.source.getLevel()
    var ivw_registryAccess = ivw_level.registryAccess()

    var ivw_recipes = []
    var ivw_flat = ivw_flatRecipes(ivw_level)
    for (var ivw_i = 0; ivw_i < ivw_flat.length; ivw_i++) {
        var ivw_r = ivw_flat[ivw_i]
        var ivw_cls = null
        try { ivw_cls = String(ivw_r.getClass().getSimpleName()) } catch (e) { continue }
        if (ivw_cls !== 'HeatingRecipe') continue
        var ivw_e = { id: null, type: null, inputIds: [], resultItem: null, resultFluid: null, temperature: null, chance: null }
        try {
            try { ivw_e.id = String(ivw_r.getId()) } catch (e) { }
            try { ivw_e.type = String(ivw_r.getType()) } catch (e) { }
            try { ivw_e.inputIds = ivw_ingredientIds(ivw_r.getIngredient(), 256) } catch (e) { ivw_e.inputError = String(e) }
            try {
                var ivw_res = ivw_r.getResultItem(ivw_registryAccess)
                if (ivw_res && !ivw_res.isEmpty()) ivw_e.resultItem = { id: String(ivw_res.getId()), count: ivw_res.getCount() }
            } catch (e) { ivw_e.resultItemError = String(e) }
            try { ivw_e.resultFluid = ivw_fluidStack(ivw_r.getDisplayOutputFluid()) } catch (e) { ivw_e.resultFluidError = String(e) }
            try { ivw_e.temperature = ivw_r.getTemperature() } catch (e) { }
            try { ivw_e.chance = ivw_r.getChance() } catch (e) { }
            ivw_sec.recipes++
        } catch (e) {
            ivw_e.error = String(e)
            ivw_sec.failed++
            ivw_err('heating', ivw_e.id, e)
        }
        ivw_recipes.push(ivw_e)
    }

    var ivw_metals = {}
    try {
        var ivw_Metal = Java.loadClass('net.dries007.tfc.util.Metal')
        for (var ivw_m of ivw_Metal.MANAGER.getValues()) {
            var ivw_mid = null
            try {
                ivw_mid = String(ivw_m.getId())
                var ivw_me = { meltTemperature: null, tier: null, fluid: null, ingotIds: [], sheetIds: [] }
                try { ivw_me.meltTemperature = ivw_m.getMeltTemperature() } catch (e) { }
                try { ivw_me.tier = ivw_m.getTier() } catch (e) { }
                try { ivw_me.fluid = ivw_fluidId(ivw_m.getFluid()) } catch (e) { }
                try { ivw_me.ingotIds = ivw_ingredientIds(ivw_m.getIngotIngredient(), 32) } catch (e) { }
                try { ivw_me.sheetIds = ivw_ingredientIds(ivw_m.getSheetIngredient(), 32) } catch (e) { }
                ivw_metals[ivw_mid] = ivw_me
                ivw_sec.metals++
            } catch (e) { ivw_err('heating-metal', ivw_mid, e) }
        }
    } catch (e) { ivw_err('heating-metal', 'MANAGER', e) }

    var ivw_fuels = {}
    try {
        var ivw_Fuel = Java.loadClass('net.dries007.tfc.util.Fuel')
        for (var ivw_f of ivw_Fuel.MANAGER.getValues()) {
            var ivw_fid = null
            try {
                ivw_fid = String(ivw_f.getId())
                // the Ingredient field is protected with no getter; getValidItems() lists the matching items
                var ivw_fe = { itemIds: [], temperature: null, duration: null, purity: null }
                try { ivw_fe.itemIds = ivw_itemIds(ivw_f.getValidItems(), 256) } catch (e) { }
                try { ivw_fe.temperature = ivw_f.getTemperature() } catch (e) { }
                try { ivw_fe.duration = ivw_f.getDuration() } catch (e) { }
                try { ivw_fe.purity = ivw_f.getPurity() } catch (e) { }
                ivw_fuels[ivw_fid] = ivw_fe
                ivw_sec.fuels++
            } catch (e) { ivw_err('heating-fuel', ivw_fid, e) }
        }
    } catch (e) { ivw_err('heating-fuel', 'MANAGER', e) }

    try {
        ivw_writeJson('heating.json', { recipes: ivw_recipes, metals: ivw_metals, fuels: ivw_fuels })
        ivw_sec.files.push(ivw_state.prefix + 'heating.json')
    } catch (e) { ivw_err('heating-write', 'heating.json', e) }
    ivw_sec.status = 'done'
    ivw_sec.ms = Date.now() - ivw_t0
    ivw_say('heating: ' + ivw_sec.recipes + ' recipes, ' + ivw_sec.metals + ' metals, ' + ivw_sec.fuels + ' fuels, ' + ivw_sec.failed + ' failed (' + ivw_sec.ms + ' ms)')
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// Section: machines (v3) - every GTCEU MetaMachineBlock with its voltage tier, i.e. exactly what
// the s3_progression_mod "gtceu_voltage_*" gates match (same check as blocked_blocks.js and
// CraftingGateEnforcer: MetaMachineBlock + getDefinition().getTier() -> GTValues.VN).
// ---------------------------------------------------------------------------------------------
function ivw_dumpMachines(ivw_ctx) {
    var ivw_t0 = Date.now()
    var ivw_sec = { status: 'running', machines: 0, failed: 0, files: [] }
    ivw_state.sections.machines = ivw_sec
    var ivw_out = {}
    var ivw_coils = {}
    var ivw_BuiltIn = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
    var ivw_MetaMachineBlock = Java.loadClass('com.gregtechceu.gtceu.api.block.MetaMachineBlock')
    var ivw_GTValues = Java.loadClass('com.gregtechceu.gtceu.api.GTValues')
    ivw_BuiltIn.BLOCK.entrySet().forEach(ivw_entry => {
        var ivw_id = null
        try {
            ivw_id = String(ivw_entry.getKey().location())
            var ivw_block = ivw_entry.getValue()
            // v5: heating coils (EBF/ABS temperature) - CoilBlock.coilType.getCoilTemperature()
            try {
                var ivw_coil = ivw_block.coilType   // public field on CoilBlock (javap of gtceu-7.5.3), no getter
                if (ivw_coil) {
                    ivw_coils[ivw_id] = { temperature: ivw_coil.getCoilTemperature(), tier: ivw_coil.getTier(), name: String(ivw_coil.getName()) }
                    return
                }
            } catch (e) { }
            if (!(ivw_block instanceof ivw_MetaMachineBlock)) return
            var ivw_tier = ivw_block.getDefinition().getTier()
            ivw_out[ivw_id] = { tier: ivw_tier, voltage: String(ivw_GTValues.VN[ivw_tier]) }
            ivw_sec.machines++
        } catch (e) {
            ivw_sec.failed++
            ivw_err('machines', ivw_id, e)
        }
    })
    ivw_writeJson('machines.json', { machines: ivw_out, coils: ivw_coils })
    ivw_sec.files.push(ivw_state.prefix + 'machines.json')
    ivw_sec.status = 'done'
    ivw_sec.ms = Date.now() - ivw_t0
    ivw_say('machines: ' + ivw_sec.machines + ' machine blocks, ' + ivw_sec.failed + ' failed (' + ivw_sec.ms + ' ms)')
}

// Section 8 (v4): loot simulation. Rolls the loot tables of the blocks/entities listed in
// lootsim_request.json (written by v3/lootsim.py) through the normal loot path, so Forge global
// loot modifiers - LootJS (addBlockLootModifier/addEntityLootModifier) included - are applied.
// Averages per item and tool go to lootsim.json. Runs in slices over server ticks (watchdog).
// Read-only: entities are created but never added to the world; blocks are not placed.
var IVW_SIM_SLICE_MS = 35

function ivw_readRequest(ivw_path) {
    var ivw_el = null
    try { ivw_el = JsonIO.readJson(ivw_path) } catch (e) { }
    if (ivw_el !== null && ivw_el !== undefined) return JSON.parse(String(ivw_el.toString()))
    var ivw_map = JsonIO.read(ivw_path)
    if (ivw_map === null || ivw_map === undefined) return null
    return JSON.parse(JSON.stringify(ivw_map))
}

function ivw_matureState(ivw_block) {
    var ivw_st = ivw_block.defaultBlockState()
    try {
        var ivw_Collections = Java.loadClass('java.util.Collections')
        var ivw_props = ivw_block.getStateDefinition().getProperties().toArray()
        for (var ivw_i = 0; ivw_i < ivw_props.length; ivw_i++) {
            var ivw_p = ivw_props[ivw_i]
            var ivw_n = String(ivw_p.getName())
            if (ivw_n === 'age' || ivw_n === 'stage' || ivw_n === 'mature' || ivw_n === 'lifecycle') {
                ivw_st = ivw_st.setValue(ivw_p, ivw_Collections.max(ivw_p.getPossibleValues()))
            }
        }
    } catch (e) { }
    return ivw_st
}

function ivw_addStacks(ivw_acc, ivw_list, ivw_FR) {
    var ivw_arr = ivw_list.toArray()
    for (var ivw_i = 0; ivw_i < ivw_arr.length; ivw_i++) {
        var ivw_stack = ivw_arr[ivw_i]
        if (ivw_stack.isEmpty()) continue
        var ivw_id = String(ivw_FR.ITEMS.getKey(ivw_stack.getItem()))
        ivw_acc[ivw_id] = (ivw_acc[ivw_id] || 0) + ivw_stack.getCount()
    }
}

function ivw_startLootSim(ivw_ctx, ivw_server) {
    var ivw_source = ivw_ctx.source
    var ivw_dir = ivw_state.dir + ivw_state.prefix
    var ivw_msg = function (ivw_m) {
        console.log('[itemvaluesdumpworld] ' + ivw_m)
        try { ivw_source.sendSystemMessage(Text.of('[itemvaluesdumpworld] ' + ivw_m)) } catch (e) { }
    }
    var ivw_req = null
    try { ivw_req = ivw_readRequest(ivw_dir + 'lootsim_request.json') } catch (e) { ivw_msg('lootsim: cannot read request: ' + e); return }
    if (!ivw_req) { ivw_msg('lootsim: ' + ivw_dir + 'lootsim_request.json missing - run v3/lootsim.py first'); return }

    var ivw_LP = Java.loadClass('net.minecraft.world.level.storage.loot.LootParams')
    var ivw_LCP = Java.loadClass('net.minecraft.world.level.storage.loot.parameters.LootContextParams')
    var ivw_LCPS = Java.loadClass('net.minecraft.world.level.storage.loot.parameters.LootContextParamSets')
    var ivw_RL = Java.loadClass('net.minecraft.resources.ResourceLocation')
    var ivw_FR = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
    var ivw_ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack')
    var ivw_level = ivw_source.getLevel()
    var ivw_player = null
    try { ivw_player = ivw_source.getPlayer() } catch (e) { }
    var ivw_pos = ivw_source.getPosition()
    var ivw_lootData = ivw_server.getLootData()
    var ivw_minRolls = ivw_req.minRolls || 8
    var ivw_maxRolls = ivw_req.maxRolls || 64
    var ivw_entityMaxRolls = ivw_req.entityMaxRolls || ivw_maxRolls
    var ivw_entityMinRolls = ivw_req.entityMinRolls || ivw_minRolls
    var ivw_tools = ivw_req.tools || ['']
    var ivw_blocks = ivw_req.blocks || []
    var ivw_entities = ivw_req.entities || []

    // work list: one job = [kind, id, tool]
    var ivw_jobs = []
    for (var ivw_b = 0; ivw_b < ivw_blocks.length; ivw_b++) {
        for (var ivw_t = 0; ivw_t < ivw_tools.length; ivw_t++) ivw_jobs.push(['block', ivw_blocks[ivw_b], ivw_tools[ivw_t]])
    }
    for (var ivw_e = 0; ivw_e < ivw_entities.length; ivw_e++) ivw_jobs.push(['entity', ivw_entities[ivw_e], ''])

    var ivw_out = {
        version: IVW_VERSION, minRolls: ivw_minRolls, maxRolls: ivw_maxRolls, tools: ivw_tools,
        heldItem: null, blocks: {}, entities: {}, errors: []
    }
    try { if (ivw_player) ivw_out.heldItem = String(ivw_FR.ITEMS.getKey(ivw_player.getMainHandItem().getItem())) } catch (e) { }
    var ivw_toolStacks = {}
    for (var ivw_k = 0; ivw_k < ivw_tools.length; ivw_k++) {
        var ivw_tid = ivw_tools[ivw_k]
        ivw_toolStacks[ivw_tid] = ivw_tid === '' ? ivw_ItemStack.EMPTY : new ivw_ItemStack(ivw_FR.ITEMS.getValue(new ivw_RL(ivw_tid)))
    }
    var ivw_stateCache = {}
    var ivw_entityCache = {}

    var ivw_rollOnce = function (ivw_job) {
        var ivw_acc = {}
        if (ivw_job[0] === 'block') {
            var ivw_c = ivw_stateCache[ivw_job[1]]
            if (!ivw_c) {
                var ivw_block = ivw_FR.BLOCKS.getValue(new ivw_RL(ivw_job[1]))
                ivw_c = { state: ivw_matureState(ivw_block), table: ivw_lootData.getLootTable(ivw_block.getLootTable()) }
                ivw_stateCache[ivw_job[1]] = ivw_c
            }
            var ivw_bld = new ivw_LP.Builder(ivw_level)
                .withParameter(ivw_LCP.ORIGIN, ivw_pos)
                .withParameter(ivw_LCP.TOOL, ivw_toolStacks[ivw_job[2]])
                .withParameter(ivw_LCP.BLOCK_STATE, ivw_c.state)
            if (ivw_player) ivw_bld = ivw_bld.withOptionalParameter(ivw_LCP.THIS_ENTITY, ivw_player)
            ivw_addStacks(ivw_acc, ivw_c.table.getRandomItems(ivw_bld.create(ivw_LCPS.BLOCK)), ivw_FR)
        } else {
            var ivw_ec = ivw_entityCache[ivw_job[1]]
            if (!ivw_ec) {
                var ivw_type = ivw_FR.ENTITY_TYPES.getValue(new ivw_RL(ivw_job[1]))
                var ivw_ent = ivw_type.create(ivw_level)
                ivw_ent.setPos(ivw_pos.x(), ivw_pos.y(), ivw_pos.z())
                ivw_ec = { entity: ivw_ent, table: ivw_lootData.getLootTable(ivw_ent.getLootTable()) }
                ivw_entityCache[ivw_job[1]] = ivw_ec
            }
            var ivw_ebld = new ivw_LP.Builder(ivw_level)
                .withParameter(ivw_LCP.THIS_ENTITY, ivw_ec.entity)
                .withParameter(ivw_LCP.ORIGIN, ivw_pos)
                .withParameter(ivw_LCP.DAMAGE_SOURCE, ivw_player ? ivw_level.damageSources().playerAttack(ivw_player) : ivw_level.damageSources().generic())
            if (ivw_player) {
                ivw_ebld = ivw_ebld.withOptionalParameter(ivw_LCP.KILLER_ENTITY, ivw_player)
                    .withOptionalParameter(ivw_LCP.DIRECT_KILLER_ENTITY, ivw_player)
                    .withOptionalParameter(ivw_LCP.LAST_DAMAGE_PLAYER, ivw_player)
            }
            ivw_addStacks(ivw_acc, ivw_ec.table.getRandomItems(ivw_ebld.create(ivw_LCPS.ENTITY)), ivw_FR)
        }
        return ivw_acc
    }

    var ivw_i = 0
    var ivw_failed = 0
    var ivw_nextReport = 2000
    var ivw_t0 = Date.now()
    ivw_msg('lootsim: ' + ivw_jobs.length + ' jobs (' + ivw_blocks.length + ' blocks x ' + ivw_tools.length + ' tools, ' + ivw_entities.length + ' entities)')

    var ivw_finish = function () {
        ivw_out.ms = Date.now() - ivw_t0
        ivw_out.failed = ivw_failed
        try {
            JsonIO.write(ivw_dir + 'lootsim.json', JsonIO.parseRaw(JSON.stringify(ivw_out)))
            ivw_msg('lootsim: done, ' + ivw_jobs.length + ' jobs, ' + ivw_failed + ' failed, ' + ivw_out.ms + ' ms -> lootsim.json')
        } catch (e) { ivw_msg('lootsim: WRITE FAILED ' + e) }
        ivw_stateCache = null
        ivw_entityCache = null
    }

    var ivw_step = function () {
        var ivw_sliceStart = Date.now()
        while (ivw_i < ivw_jobs.length && Date.now() - ivw_sliceStart < IVW_SIM_SLICE_MS) {
            var ivw_job = ivw_jobs[ivw_i++]
            try {
                var ivw_sum = {}
                var ivw_first = null
                var ivw_same = true
                var ivw_n = 0
                var ivw_cap = ivw_job[0] === 'entity' ? ivw_entityMaxRolls : ivw_maxRolls
                while (ivw_n < ivw_cap) {
                    var ivw_r = ivw_rollOnce(ivw_job)
                    var ivw_key = JSON.stringify(ivw_r)
                    if (ivw_first === null) ivw_first = ivw_key
                    else if (ivw_key !== ivw_first) ivw_same = false
                    for (var ivw_it in ivw_r) ivw_sum[ivw_it] = (ivw_sum[ivw_it] || 0) + ivw_r[ivw_it]
                    ivw_n++
                    if (ivw_n >= (ivw_job[0] === 'entity' ? ivw_entityMinRolls : ivw_minRolls) && ivw_same) break
                }
                var ivw_avg = {}
                for (var ivw_it2 in ivw_sum) ivw_avg[ivw_it2] = ivw_sum[ivw_it2] / ivw_n
                if (ivw_job[0] === 'block') {
                    if (!ivw_out.blocks[ivw_job[1]]) ivw_out.blocks[ivw_job[1]] = {}
                    ivw_out.blocks[ivw_job[1]][ivw_job[2]] = ivw_avg
                } else {
                    ivw_out.entities[ivw_job[1]] = ivw_avg
                }
            } catch (e) {
                ivw_failed++
                if (ivw_out.errors.length < 2000) ivw_out.errors.push({ kind: ivw_job[0], id: ivw_job[1], tool: ivw_job[2], error: String(e) })
            }
        }
        if (ivw_i < ivw_jobs.length) {
            if (ivw_i >= ivw_nextReport) {
                ivw_msg('lootsim: ' + ivw_i + '/' + ivw_jobs.length)
                ivw_nextReport += 5000
            }
            ivw_server.scheduleInTicks(1, function () { ivw_step() })
        } else {
            ivw_finish()
        }
    }
    ivw_step()
}

function ivw_run(ivw_ctx, ivw_which) {
    ivw_state = ivw_newState()
    ivw_state.ctx = ivw_ctx
    ivw_state.startedAt = ivw_now()
    var ivw_t0 = Date.now()
    console.log('===ITEMVALUES-DUMP-WORLD-START=== (' + ivw_which + ')')
    if (!ivw_initOutput()) {
        ivw_say('ABORTED: cannot write any output file (see log)')
        return 1
    }
    ivw_say('writing to ' + ivw_state.dir + ivw_state.prefix + '*')
    var ivw_server = null
    try { ivw_server = ivw_ctx.source.getServer() } catch (e) {
        ivw_say('ABORTED: no server: ' + e)
        return 1
    }
    try { ivw_state.sections.ops = ivw_initOps(ivw_server) } catch (e) { ivw_err('init', 'ops', e) }
    ivw_writeIndex()

    if (ivw_which === 'all' || ivw_which === 'knapping') {
        try { ivw_dumpKnapping(ivw_ctx) } catch (e) { ivw_err('knapping', 'SECTION', e); ivw_say('knapping SECTION FAILED: ' + e) }
        ivw_writeIndex()
    }
    if (ivw_which === 'all' || ivw_which === 'barrel') {
        try { ivw_dumpBarrel(ivw_ctx) } catch (e) { ivw_err('barrel', 'SECTION', e); ivw_say('barrel SECTION FAILED: ' + e) }
        ivw_writeIndex()
    }
    if (ivw_which === 'all' || ivw_which === 'heating') {
        try { ivw_dumpHeating(ivw_ctx) } catch (e) { ivw_err('heating', 'SECTION', e); ivw_say('heating SECTION FAILED: ' + e) }
        ivw_writeIndex()
    }
    if (ivw_which === 'all' || ivw_which === 'machines') {
        try { ivw_dumpMachines(ivw_ctx) } catch (e) { ivw_err('machines', 'SECTION', e); ivw_say('machines SECTION FAILED: ' + e) }
        ivw_writeIndex()
    }
    if (ivw_which === 'lootsim') {
        try { ivw_startLootSim(ivw_ctx, ivw_server) } catch (e) { ivw_err('lootsim', 'SECTION', e); ivw_say('lootsim SECTION FAILED: ' + e) }
    }
    if (ivw_which === 'all' || ivw_which === 'loot') {
        try { ivw_dumpLoot(ivw_server) } catch (e) { ivw_err('loot', 'SECTION', e); ivw_say('loot SECTION FAILED: ' + e) }
        ivw_writeIndex()
    }
    if (ivw_which === 'all' || ivw_which === 'biomes') {
        try { ivw_dumpBiomes(ivw_server) } catch (e) { ivw_err('biomes', 'SECTION', e); ivw_say('biomes SECTION FAILED: ' + e) }
        ivw_writeIndex()
    }
    if (ivw_which === 'all' || ivw_which === 'features') {
        if (ivw_state.ops === null) {
            ivw_err('features', 'SECTION', 'no DynamicOps available, skipped')
        } else {
            try { ivw_dumpFeatures(ivw_server) } catch (e) { ivw_err('features', 'SECTION', e); ivw_say('features SECTION FAILED: ' + e) }
        }
        ivw_writeIndex()
    }
    var ivw_ms = Date.now() - ivw_t0
    ivw_state.sections.totalMs = ivw_ms
    ivw_writeIndex()
    ivw_say('done in ' + ivw_ms + ' ms, ' + ivw_state.errorCount + ' errors (see _index.json)')
    console.log('===ITEMVALUES-DUMP-WORLD-END=== (' + ivw_ms + ' ms)')
    ivw_state.ctx = null
    return 1
}

ServerEvents.commandRegistry(event => {
    var { commands: ivw_Commands } = event

    event.register(
        ivw_Commands.literal('itemvaluesdumpworld').requires(ivw_src => ivw_src.hasPermission(2))
            .executes(ivw_ctx => ivw_run(ivw_ctx, 'all'))
            .then(ivw_Commands.literal('knapping').executes(ivw_ctx => ivw_run(ivw_ctx, 'knapping')))
            .then(ivw_Commands.literal('barrel').executes(ivw_ctx => ivw_run(ivw_ctx, 'barrel')))
            .then(ivw_Commands.literal('heating').executes(ivw_ctx => ivw_run(ivw_ctx, 'heating')))
            .then(ivw_Commands.literal('machines').executes(ivw_ctx => ivw_run(ivw_ctx, 'machines')))
            .then(ivw_Commands.literal('loot').executes(ivw_ctx => ivw_run(ivw_ctx, 'loot')))
            .then(ivw_Commands.literal('biomes').executes(ivw_ctx => ivw_run(ivw_ctx, 'biomes')))
            .then(ivw_Commands.literal('features').executes(ivw_ctx => ivw_run(ivw_ctx, 'features')))
            .then(ivw_Commands.literal('lootsim').executes(ivw_ctx => ivw_run(ivw_ctx, 'lootsim')))
    )
})
