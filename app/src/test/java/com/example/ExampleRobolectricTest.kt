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
}
