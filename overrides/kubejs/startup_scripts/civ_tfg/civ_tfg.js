

// Register new items
StartupEvents.registry('item', event => {
    event.create('civ_tfg:pocket_gps')
    .displayName('Pocket GPS')
    .texture('civ_tfg:item/pocket_gps')
    .unstackable()
    .tooltip("Keep in your hotbar to enable the map")
})
