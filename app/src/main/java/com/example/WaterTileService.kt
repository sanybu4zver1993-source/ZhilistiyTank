package com.example

import android.content.Context
import android.content.SharedPreferences
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast

class WaterTileService : TileService() {
    override fun onClick() {
        super.onClick()
        val prefs: SharedPreferences = getSharedPreferences("TankPrefs", Context.MODE_PRIVATE)
        val current = prefs.getInt("water_ml", 0)
        val newAmount = current + 250
        prefs.edit().putInt("water_ml", newAmount).apply()
        
        val tile = qsTile
        tile.label = "$newAmount мл"
        tile.state = Tile.STATE_ACTIVE
        tile.updateTile()
    }

    override fun onStartListening() {
        super.onStartListening()
        val prefs: SharedPreferences = getSharedPreferences("TankPrefs", Context.MODE_PRIVATE)
        val current = prefs.getInt("water_ml", 0)
        val tile = qsTile
        tile.label = if (current > 0) "$current мл" else "Вода +250"
        tile.state = Tile.STATE_INACTIVE
        tile.updateTile()
    }
}
