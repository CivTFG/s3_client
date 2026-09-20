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


// Add tooltips for each coin
ItemEvents.tooltip(event => {
    coins.forEach(coin => {
        event.addAdvanced(coin, (item, advanced, text) => {
            const creator = item.nbt?.creator
            if (creator) {
                text.add(Text.gray(`Created by ${creator}`))
            }
        })
    })
})
