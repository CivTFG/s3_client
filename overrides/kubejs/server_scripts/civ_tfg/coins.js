// Resolves the FTB Team that claims the chunk a player is standing in, the same lookup
// s3_progression_mod's Java side uses (ProgressionTiers.resolveTeam): FTBChunksAPI's
// manager -> ClaimedChunk for this ChunkDimPos -> its ChunkTeamData -> the owning Team.
// Falls back to null (caller falls back to the player's own name) if the chunk is unclaimed.
const ChunkDimPos = Java.loadClass("dev.ftb.mods.ftblibrary.math.ChunkDimPos");
const FTBChunksAPI = Java.loadClass("dev.ftb.mods.ftbchunks.api.FTBChunksAPI");

function resolveClaimingTeamName(player) {
    const chunkDimPos = new ChunkDimPos(player);
    const claim = FTBChunksAPI.api().getManager().getChunk(chunkDimPos);
    if (!claim) return null;
    const team = claim.getTeamData().getTeam();
    return team ? team.getShortName() : null;
}

const coins = [
    "kubejs:bismuth_bronze_coin",
    "kubejs:black_bronze_coin",
    "kubejs:black_steel_coin",
    "createdeco:netherite_coin", // Blue steel
    "createdeco:brass_coin",
    "kubejs:bronze_coin",
    "createdeco:copper_coin",
    "createdeco:gold_coin",
    "kubejs:red_steel_coin",
    "createdeco:industrial_iron_coin", // Steel
    "kubejs:tin_coin",
    "createdeco:iron_coin", // wrought iron
    "createdeco:zinc_coin"
]


// Add recipes
ServerEvents.recipes((event) => {
    coins.forEach(coin => {
        event.remove({ output: coin + "stack" }) // Remove recipes for coinstacks
    })

    // Add all coin crafting
    // Explicit .id() on every recipe here: without one, KubeJS auto-generates an id, and
    // several of these outputs (the createdeco:* ones) already have an official GTCEU
    // Forming Press recipe registered in createdeco/recipes.js (also without an explicit
    // id). Two un-id'd recipes for the same output can collide on the same auto-generated
    // id - KubeJS silently keeps only the last one loaded ("Using last one encountered.")
    // - so explicit, unique ids here remove that risk entirely regardless of load order.
    event.shapeless('createdeco:gold_coin', [
        '#forge:nuggets/gold',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/gold_coin');

    event.shapeless('createdeco:netherite_coin', [
        '#forge:nuggets/blue_steel',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/netherite_coin');

    event.shapeless('createdeco:brass_coin', [
        '#forge:nuggets/brass',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/brass_coin');

    event.shapeless('createdeco:iron_coin', [
        '#forge:nuggets/wrought_iron',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/iron_coin');

    event.shapeless('createdeco:copper_coin', [
        '#forge:nuggets/copper',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/copper_coin');

    event.shapeless('createdeco:industrial_iron_coin', [
        '#forge:nuggets/steel',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/industrial_iron_coin');

    event.shapeless('createdeco:zinc_coin', [
        '#forge:nuggets/zinc',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/zinc_coin');

    event.shapeless('kubejs:bronze_coin', [
        '#forge:nuggets/bronze',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/bronze_coin');

    event.shapeless('kubejs:tin_coin', [
        '#forge:nuggets/tin',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/tin_coin');

    event.shapeless('kubejs:bismuth_bronze_coin', [
        '#forge:nuggets/bismuth_bronze',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/bismuth_bronze_coin');

    event.shapeless('kubejs:black_bronze_coin', [
        '#forge:nuggets/black_bronze',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/black_bronze_coin');

    event.shapeless('kubejs:black_steel_coin', [
        '#forge:nuggets/black_steel',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/black_steel_coin');

    event.shapeless('kubejs:red_steel_coin', [
        '#forge:nuggets/red_steel',
        '#forge:tools/hammers'
    ]).id('civ_tfg:crafting/red_steel_coin');
})


// Add nbt tag when crafted - the claiming team if the player is standing on claimed land,
// otherwise the player's own name (unclaimed land, or FTB Chunks/Teams not loaded).
ItemEvents.crafted((event) => {
    coins.forEach(coin => {
        if (event.item.id === coin) {
            const player = event.player
            if (player) {
                event.item.nbt = event.item.nbt ?? {}
                event.item.nbt.creator = resolveClaimingTeamName(player) ?? player.username
            }
        }
    })
});