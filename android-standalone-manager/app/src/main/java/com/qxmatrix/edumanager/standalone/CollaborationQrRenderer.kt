package com.qxmatrix.edumanager.standalone

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

internal object CollaborationQrRenderer {
    fun render(value: String, size: Int): Bitmap {
        require(value.isNotBlank() && value.toByteArray(Charsets.UTF_8).size <= 16 * 1024) { "二维码内容为空或过长" }
        val dimension = size.coerceIn(320, 1_200)
        val matrix = MultiFormatWriter().encode(
            value,
            BarcodeFormat.QR_CODE,
            dimension,
            dimension,
            mapOf(
                EncodeHintType.CHARACTER_SET to "UTF-8",
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
                EncodeHintType.MARGIN to 2,
            ),
        )
        val pixels = IntArray(dimension * dimension)
        for (y in 0 until dimension) for (x in 0 until dimension) {
            pixels[y * dimension + x] = if (matrix[x, y]) Color.BLACK else Color.WHITE
        }
        return Bitmap.createBitmap(dimension, dimension, Bitmap.Config.ARGB_8888).apply {
            setPixels(pixels, 0, dimension, 0, 0, dimension, dimension)
        }
    }
}
