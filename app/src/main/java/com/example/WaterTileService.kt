package com.example

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class WaterTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        refreshTileUi(WaterSyncBus.getDisplayTotalMl(this))
    }

    override fun onClick() {
        super.onClick()
        val newTotal = WaterSyncBus.enqueueFromTile(this, 250)
        refreshTileUi(newTotal)
    }

    private fun refreshTileUi(totalMl: Int) {
        val tile = qsTile ?: return
        tile.state = if (totalMl > 0) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = if (totalMl > 0) "Вода: $totalMl мл" else "Вода +250"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = "+250 мл"
        }
        tile.updateTile()
    }
}
