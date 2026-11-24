package com.example

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object FoodPreAnalyzer {
    private const val TAG = "VeinyTankML"

    private val imageLabeler by lazy {
        ImageLabeling.getClient(
            ImageLabelerOptions.Builder()
                .setConfidenceThreshold(0.45f)
                .build()
        )
    }

    private val objectDetector by lazy {
        ObjectDetection.getClient(
            ObjectDetectorOptions.Builder()
                .setDetectorMode(ObjectDetectorOptions.SINGLE_IMAGE_MODE)
                .enableMultipleObjects()
                .enableClassification()
                .build()
        )
    }

    private val barcodeScanner by lazy {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                    Barcode.FORMAT_EAN_13,
                    Barcode.FORMAT_EAN_8,
                    Barcode.FORMAT_UPC_A,
                    Barcode.FORMAT_UPC_E,
                    Barcode.FORMAT_QR_CODE
                )
                .build()
        )
    }

    private val textRecognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    fun analyzeBase64(base64Data: String): JSONObject {
        val startedAt = SystemClock.elapsedRealtime()
        val rawBytes = try {
            val clean = base64Data.substringAfter("base64,", base64Data).trim()
            Base64.decode(clean, Base64.DEFAULT)
        } catch (t: Throwable) {
            return JSONObject()
                .put("ok", false)
                .put("error", "Invalid base64 image: ${t.message}")
        }

        val bitmap = decodeScaledBitmap(rawBytes, 1024)
            ?: return JSONObject()
                .put("ok", false)
                .put("error", "Не удалось декодировать изображение")

        return try {
            val width = max(1, bitmap.width)
            val height = max(1, bitmap.height)
            val totalArea = (width * height).toDouble()

            val qualityObj = computeQualityAndOilHeuristics(bitmap)
            val inputImage = InputImage.fromBitmap(bitmap, 0)

            // Launch all 4 on-device ML Kit models simultaneously on the decoded bitmap
            val labelsTask = imageLabeler.process(inputImage)
            val objectsTask = objectDetector.process(inputImage)
            val barcodesTask = barcodeScanner.process(inputImage)
            val textTask = textRecognizer.process(inputImage)

            val labelsJson = JSONArray()
            val topLabelsRu = mutableListOf<String>()
            runCatching { Tasks.await(labelsTask, 3500L, TimeUnit.MILLISECONDS) }
                .onSuccess { labels ->
                    labels.sortedByDescending { it.confidence }
                        .take(8)
                        .forEach { lbl ->
                            val pct = (lbl.confidence * 100f).roundToInt()
                            labelsJson.put(
                                JSONObject()
                                    .put("label", lbl.text)
                                    .put("confidencePct", pct)
                            )
                            if (topLabelsRu.size < 5) {
                                topLabelsRu.add("${lbl.text} ($pct%)")
                            }
                        }
                }
                .onFailure { Log.w(TAG, "Labeling failed: ${it.message}") }

            val objectsJson = JSONArray()
            runCatching { Tasks.await(objectsTask, 3500L, TimeUnit.MILLISECONDS) }
                .onSuccess { objs ->
                    objs.take(6).forEach { obj ->
                        val box = obj.boundingBox
                        val areaPct = (((box.width().toDouble() * box.height().toDouble()) / totalArea) * 100.0)
                            .coerceIn(0.0, 100.0)
                        val primaryLabel = obj.labels.maxByOrNull { it.confidence }
                        val cat = primaryLabel?.text ?: "Object"
                        val catPct = ((primaryLabel?.confidence ?: 0f) * 100f).roundToInt()
                        objectsJson.put(
                            JSONObject()
                                .put("category", cat)
                                .put("confidencePct", catPct)
                                .put("areaPct", (areaPct * 10.0).roundToInt() / 10.0)
                        )
                    }
                }
                .onFailure { Log.w(TAG, "Object detection failed: ${it.message}") }

            val barcodesJson = JSONArray()
            var retailBarcode: String? = null
            runCatching { Tasks.await(barcodesTask, 2500L, TimeUnit.MILLISECONDS) }
                .onSuccess { codes ->
                    codes.take(4).forEach { bc ->
                        val raw = bc.rawValue?.trim().orEmpty()
                        if (raw.isNotEmpty()) {
                            barcodesJson.put(
                                JSONObject()
                                    .put("value", raw)
                                    .put("format", barcodeFormatName(bc.format))
                            )
                            if (retailBarcode == null &&
                                bc.format != Barcode.FORMAT_QR_CODE &&
                                raw.length in 8..14 &&
                                raw.all { it.isDigit() }
                            ) {
                                retailBarcode = raw
                            }
                        }
                    }
                }
                .onFailure { Log.w(TAG, "Barcode scan failed: ${it.message}") }

            val ocrLinesJson = JSONArray()
            val cleanOcrLines = mutableListOf<String>()
            runCatching { Tasks.await(textTask, 3500L, TimeUnit.MILLISECONDS) }
                .onSuccess { visionText ->
                    val seen = LinkedHashSet<String>()
                    for (block in visionText.textBlocks) {
                        for (line in block.lines) {
                            val txt = line.text.replace(Regex("\\s+"), " ").trim()
                            if (txt.length >= 2 && txt.length <= 80 && seen.add(txt)) {
                                cleanOcrLines.add(txt)
                                ocrLinesJson.put(txt)
                                if (cleanOcrLines.size >= 8) break
                            }
                        }
                        if (cleanOcrLines.size >= 8) break
                    }
                }
                .onFailure { Log.w(TAG, "OCR failed: ${it.message}") }

            // If an EAN/UPC product barcode was found on packaging/bottle, query OpenFoodFacts for exact nutrition
            val offProduct = retailBarcode?.let { lookupOpenFoodFacts(it) }

            val elapsed = SystemClock.elapsedRealtime() - startedAt
            val modelsUsed = JSONArray(
                listOf(
                    "MLKit ImageLabeling",
                    "MLKit ObjectDetection",
                    "MLKit Barcode",
                    "MLKit TextOCR",
                    "CV Oil/Light Check"
                )
            )

            val summaryParts = mutableListOf<String>()
            if (topLabelsRu.isNotEmpty()) {
                summaryParts.add("🏷️ Теги: ${topLabelsRu.joinToString(", ")}")
            }
            if (objectsJson.length() > 0) {
                val objDesc = (0 until objectsJson.length()).joinToString(", ") { i ->
                    val o = objectsJson.getJSONObject(i)
                    "${o.optString("category")} (${o.optDouble("areaPct")}% кадра)"
                }
                summaryParts.add("📦 Объекты: $objDesc")
            }
            if (offProduct != null) {
                val pName = offProduct.optString("name", "Товар")
                val kcal = offProduct.optDouble("kcal100g", -1.0)
                val b = offProduct.optDouble("b100g", -1.0)
                val f = offProduct.optDouble("f100g", -1.0)
                val u = offProduct.optDouble("u100g", -1.0)
                val nutr = if (kcal >= 0) {
                    " — ${kcal.roundToInt()} ккал/100г (Б:${b.coerceAtLeast(0.0).roundToInt()} Ж:${f.coerceAtLeast(0.0).roundToInt()} У:${u.coerceAtLeast(0.0).roundToInt()})"
                } else ""
                summaryParts.add("🧾 Штрихкод $retailBarcode: $pName$nutr")
            } else if (barcodesJson.length() > 0) {
                summaryParts.add("🧾 Код: ${barcodesJson.getJSONObject(0).optString("value")}")
            }
            if (cleanOcrLines.isNotEmpty()) {
                summaryParts.add("🔤 Текст на пачке: ${cleanOcrLines.take(4).joinToString(" | ")}")
            }
            if (qualityObj.optBoolean("highOilGlare", false)) {
                summaryParts.add("✨ Блеск масла/соуса: повышен (${qualityObj.optDouble("glarePct")}%)")
            }
            if (qualityObj.optBoolean("isDark", false)) {
                summaryParts.add("🌑 Темноватое фото — возможна неточность")
            } else if (qualityObj.optBoolean("isBlurry", false)) {
                summaryParts.add("🌫 Смазанное фото — возможна неточность")
            }

            JSONObject()
                .put("ok", true)
                .put("elapsedMs", elapsed)
                .put("modelsUsed", modelsUsed)
                .put("labels", labelsJson)
                .put("objects", objectsJson)
                .put("barcodes", barcodesJson)
                .put("ocrLines", ocrLinesJson)
                .put("quality", qualityObj)
                .apply {
                    if (offProduct != null) put("openFoodFacts", offProduct)
                }
                .put("summaryRu", summaryParts.joinToString("\n"))
        } catch (t: Throwable) {
            Log.e(TAG, "FoodPreAnalyzer error: ${t.message}")
            JSONObject()
                .put("ok", false)
                .put("error", t.message ?: "ML pre-scan failed")
        } finally {
            bitmap.recycle()
        }
    }

    private fun decodeScaledBitmap(bytes: ByteArray, maxDim: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val rawW = bounds.outWidth
        val rawH = bounds.outHeight
        if (rawW <= 0 || rawH <= 0) return null

        var sample = 1
        while (rawW / sample > maxDim * 2 || rawH / sample > maxDim * 2) {
            sample *= 2
        }
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
        return if (decoded.config != Bitmap.Config.ARGB_8888) {
            val copy = decoded.copy(Bitmap.Config.ARGB_8888, false)
            decoded.recycle()
            copy
        } else {
            decoded
        }
    }

    private fun computeQualityAndOilHeuristics(bitmap: Bitmap): JSONObject {
        val w = bitmap.width
        val h = bitmap.height
        val step = max(1, min(w, h) / 140)
        var count = 0
        var lumaSum = 0.0
        var edgeDiffSum = 0.0
        var edgeCount = 0
        var centerCount = 0
        var centerSpecularCount = 0

        val xMin = (w * 0.2).toInt()
        val xMax = (w * 0.8).toInt()
        val yMin = (h * 0.2).toInt()
        val yMax = (h * 0.8).toInt()

        var y = 0
        while (y < h) {
            var x = 0
            var prevLuma = -1.0
            while (x < w) {
                val p = bitmap.getPixel(x, y)
                val r = (p shr 16) and 0xFF
                val g = (p shr 8) and 0xFF
                val b = p and 0xFF
                val luma = 0.299 * r + 0.587 * g + 0.114 * b
                lumaSum += luma
                count++

                if (prevLuma >= 0.0) {
                    edgeDiffSum += abs(luma - prevLuma)
                    edgeCount++
                }
                prevLuma = luma

                if (x in xMin..xMax && y in yMin..yMax) {
                    centerCount++
                    val maxC = max(r, max(g, b))
                    val minC = min(r, min(g, b))
                    if (luma > 240.0 && (maxC - minC) < 28) {
                        centerSpecularCount++
                    }
                }
                x += step
            }
            y += step
        }

        val avgLuma = if (count > 0) lumaSum / count else 128.0
        val sharpness = if (edgeCount > 0) edgeDiffSum / edgeCount else 15.0
        val glarePct = if (centerCount > 0) (centerSpecularCount * 100.0 / centerCount) else 0.0
        // Specular oil/sauce spots appear as compact bright highlights on non-white surfaces
        val highOilGlare = avgLuma < 185.0 && glarePct in 2.5..22.0

        return JSONObject()
            .put("brightnessAvg", avgLuma.roundToInt())
            .put("sharpness", (sharpness * 10.0).roundToInt() / 10.0)
            .put("glarePct", (glarePct * 10.0).roundToInt() / 10.0)
            .put("isDark", avgLuma < 52.0)
            .put("isBlurry", sharpness < 8.5)
            .put("highOilGlare", highOilGlare)
    }

    private fun barcodeFormatName(fmt: Int): String = when (fmt) {
        Barcode.FORMAT_EAN_13 -> "EAN-13"
        Barcode.FORMAT_EAN_8 -> "EAN-8"
        Barcode.FORMAT_UPC_A -> "UPC-A"
        Barcode.FORMAT_UPC_E -> "UPC-E"
        Barcode.FORMAT_QR_CODE -> "QR"
        else -> "BARCODE"
    }

    private fun lookupOpenFoodFacts(barcode: String): JSONObject? {
        return try {
            val encoded = URLEncoder.encode(barcode, "UTF-8")
            val url = "https://world.openfoodfacts.org/api/v2/product/$encoded.json?fields=product_name,product_name_ru,product_name_uk,brands,quantity,serving_size,nutriments"
            val resp = ResilientNetwork.get(url, connectTimeoutMs = 3000, readTimeoutMs = 3500)
            if (!resp.ok) return null
            val root = JSONObject(resp.body)
            if (root.optInt("status", 0) != 1) return null
            val prod = root.optJSONObject("product") ?: return null
            val name = prod.optString("product_name_ru", "").ifBlank {
                prod.optString("product_name_uk", "").ifBlank {
                    prod.optString("product_name", "")
                }
            }.trim()
            val brands = prod.optString("brands", "").trim()
            val quantity = prod.optString("quantity", "").trim()
            val nutriments = prod.optJSONObject("nutriments")
            val kcal = nutriments?.optDouble("energy-kcal_100g", -1.0)?.takeIf { !it.isNaN() } ?: -1.0
            val b = nutriments?.optDouble("proteins_100g", -1.0)?.takeIf { !it.isNaN() } ?: -1.0
            val f = nutriments?.optDouble("fat_100g", -1.0)?.takeIf { !it.isNaN() } ?: -1.0
            val u = nutriments?.optDouble("carbohydrates_100g", -1.0)?.takeIf { !it.isNaN() } ?: -1.0

            val fullName = listOf(brands, name, quantity).filter { it.isNotBlank() }.joinToString(" · ")
            if (fullName.isBlank() && kcal < 0) return null

            JSONObject()
                .put("barcode", barcode)
                .put("name", fullName.ifBlank { "Товар $barcode" })
                .put("quantity", quantity)
                .put("servingSize", prod.optString("serving_size", ""))
                .put("kcal100g", if (kcal >= 0) kcal else -1.0)
                .put("b100g", if (b >= 0) b else -1.0)
                .put("f100g", if (f >= 0) f else -1.0)
                .put("u100g", if (u >= 0) u else -1.0)
        } catch (t: Throwable) {
            Log.w(TAG, "OpenFoodFacts lookup skipped: ${t.message}")
            null
        }
    }
}
