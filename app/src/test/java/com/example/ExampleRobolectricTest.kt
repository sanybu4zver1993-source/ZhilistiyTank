package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

  @Test
  fun `read string from context`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val appName = context.getString(R.string.app_name)
    assertEquals("Жилистый Танк", appName)
  }

  @Test
  fun `parseSirenRegionsIndex extracts Chernihiv hromada district and Kyiv accurately`() {
    val sampleRegionsJson = """
      {
        "states": [
          {
            "regionId": "31",
            "regionName": "м. Київ",
            "regionType": "State",
            "regionChildIds": []
          },
          {
            "regionId": "25",
            "regionName": "Чернігівська область",
            "regionType": "State",
            "regionChildIds": [
              {
                "regionId": "140",
                "regionName": "Чернігівський район",
                "regionType": "District",
                "regionChildIds": [
                  {
                    "regionId": "1401",
                    "regionName": "Чернігівська територіальна громада",
                    "regionType": "Community"
                  }
                ]
              }
            ]
          }
        ]
      }
    """.trimIndent()

    val index = AirAlertHelper.parseSirenRegionsIndex(sampleRegionsJson)
    val chernihiv = index.getJSONObject("Чернигов")
    assertEquals("25", chernihiv.getString("stateId"))
    assertEquals("140", chernihiv.getString("districtId"))
    assertEquals("1401", chernihiv.getString("communityId"))

    val kyiv = index.getJSONObject("Киев")
    assertEquals("31", kyiv.getString("stateId"))
    assertEquals("31", kyiv.getString("communityId"))
  }

  @Test
  fun `isValidJsonPayload rejects HTML error pages and accepts JSON`() {
    assertEquals(false, AirAlertHelper.isValidJsonPayload("<html><body>502 Bad Gateway</body></html>"))
    assertEquals(false, AirAlertHelper.isValidJsonPayload(""))
    assertEquals(true, AirAlertHelper.isValidJsonPayload("[]"))
    assertEquals(true, AirAlertHelper.isValidJsonPayload("{\"states\":{}}"))
  }

  @Test
  fun `AirAlertHelper semantic validators distinguish empty clear array from error JSON`() {
    assertEquals(true, AirAlertHelper.isValidSirenAlertsPayload("[]"))
    assertEquals(true, AirAlertHelper.isValidSirenAlertsPayload("{\"activeAlerts\":[]}"))
    assertEquals(false, AirAlertHelper.isValidSirenAlertsPayload("{\"error\":\"rate limit\"}"))
    assertEquals(false, AirAlertHelper.isValidSirenAlertsPayload("<html>502</html>"))

    assertEquals(true, AirAlertHelper.isValidAlertsInUaPayload("{\"alerts\":[]}"))
    assertEquals(false, AirAlertHelper.isValidAlertsInUaPayload("{\"error\":\"unauthorized\"}"))

    assertEquals(true, AirAlertHelper.isValidUbillingPayload("{\"states\":{}}"))
    assertEquals(false, AirAlertHelper.isValidUbillingPayload("{\"error\":\"upstream error\"}"))
  }

  @Test
  fun `WaterSyncBus caps pending queue at 100 events and clears cleanly`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    WaterSyncBus.clearAll(context)

    repeat(115) {
      WaterSyncBus.enqueueFromTile(context, 250)
    }

    val raw = WaterSyncBus.peekPendingJson(context)
    val arr = org.json.JSONArray(raw)
    assertEquals(100, arr.length())
    assertEquals(115 * 250, WaterSyncBus.getDisplayTotalMl(context))

    val ackIds = org.json.JSONArray()
    for (i in 0 until arr.length()) {
      ackIds.put(arr.getJSONObject(i).getString("id"))
    }
    WaterSyncBus.ackEventsAndSyncDisplay(context, ackIds.toString(), 500)
    assertEquals("[]", WaterSyncBus.peekPendingJson(context))
    assertEquals(500, WaterSyncBus.getDisplayTotalMl(context))

    WaterSyncBus.clearAll(context)
    assertEquals(0, WaterSyncBus.getDisplayTotalMl(context))
  }

  @Test
  fun `WaterSyncBus quiet hours trigger avoids night window`() {
    val triggerMs = WaterSyncBus.computeQuietHoursAwareTriggerMillis(3600L)
    val cal = java.util.Calendar.getInstance().apply { timeInMillis = triggerMs }
    val minuteOfDay = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
    org.junit.Assert.assertTrue(
      "Trigger minuteOfDay=$minuteOfDay should be within 08:30..22:29",
      minuteOfDay in (8 * 60 + 30)..(22 * 60 + 29)
    )
  }

  @Test
  fun `VaultManager RAM session state clears cleanly`() {
    VaultManager.clearSessionInRam()
    assertEquals(false, VaultManager.hasActiveSession())
    assertEquals(-1, VaultManager.getActiveSlot())
  }
}
