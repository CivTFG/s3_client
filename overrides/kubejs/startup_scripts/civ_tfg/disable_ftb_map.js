// Block the FTB Chunks large map screen, but keep the chunk claim screen working.
// ForgeEvents is only bound in startup scripts; ScreenEvent only exists on the client.
// FTB Library opens its GUIs inside a ScreenWrapper, so unwrap it before checking.
if (Platform.isClientEnvironment()) {
    ForgeEvents.onEvent('net.minecraftforge.client.event.ScreenEvent$Opening', event => {
        let screen = event.getNewScreen()
        if (!screen) return
        let gui = screen.getClass().getName().startsWith('dev.ftb.mods.ftblibrary.ui.') && screen.getGui ? screen.getGui() : screen
        if (gui && gui.getClass().getName() == 'dev.ftb.mods.ftbchunks.client.gui.LargeMapScreen') {
            event.setCanceled(true)
        }
    })
}