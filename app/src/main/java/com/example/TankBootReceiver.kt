package com.example

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TankBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            WaterSyncBus.rescheduleOnBoot(context)
        }
    }
}
