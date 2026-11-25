package com.qxmatrix.edumanager.standalone

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class LicenseQrScannerActivity : ComponentActivity() {
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val frameInFlight = AtomicBoolean(false)
    private val resultDelivered = AtomicBoolean(false)
    private val barcodeScanner by lazy {
        BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
    }
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildScannerView())
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            PermissionRationale.request(this, Manifest.permission.CAMERA, REQUEST_CAMERA_PERMISSION,
                R.string.permission_camera_title, R.string.permission_camera_reason) {
                statusText.text = "未启用相机，可返回后粘贴激活码或从相册识别二维码。"
            }
        }
    }

    private fun buildScannerView(): FrameLayout {
        previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        statusText = TextView(this).apply {
            text = "将激活码二维码放入取景框内\n识别过程完全在本机完成"
            textSize = 17f
            setTextColor(Color.WHITE)
            setBackgroundColor(0xB3000000.toInt())
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(14), dp(18), dp(14))
        }
        val close = Button(this).apply {
            text = "取消"
            YouthUi.applyButton(this, UiPreferences(this@LicenseQrScannerActivity).palette(), YouthButtonRole.PRIMARY)
            setOnClickListener { finish() }
        }
        return FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(previewView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(LinearLayout(this@LicenseQrScannerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(18), dp(24), dp(18), dp(24))
                addView(statusText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                addView(close, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) })
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        }
    }

    @androidx.annotation.OptIn(markerClass = [androidx.camera.core.ExperimentalGetImage::class])
    private fun startCamera() {
        statusText.text = "将激活码二维码放入取景框内\n识别过程完全在本机完成"
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val cameraProvider = runCatching { providerFuture.get() }.getOrElse {
                statusText.text = "无法启动摄像头：${it.message ?: "未知错误"}"
                return@addListener
            }
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                if (!frameInFlight.compareAndSet(false, true)) {
                    imageProxy.close()
                    return@setAnalyzer
                }
                val mediaImage = imageProxy.image
                if (mediaImage == null) {
                    frameInFlight.set(false)
                    imageProxy.close()
                    return@setAnalyzer
                }
                val input = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                barcodeScanner.process(input)
                    .addOnSuccessListener { barcodes ->
                        val token = barcodes.asSequence().mapNotNull { LicenseQrPayload.normalize(it.rawValue) }.firstOrNull()
                        if (token != null && resultDelivered.compareAndSet(false, true)) {
                            setResult(RESULT_OK, Intent().putExtra(EXTRA_LICENSE_TOKEN, token))
                            finish()
                        }
                    }
                    .addOnFailureListener { runOnUiThread { statusText.text = "识别暂时失败，请保持二维码清晰并重试。" } }
                    .addOnCompleteListener {
                        frameInFlight.set(false)
                        imageProxy.close()
                    }
            }
            runCatching {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }.onFailure { statusText.text = "摄像头不可用：${it.message ?: "未知错误"}" }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CAMERA_PERMISSION) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startCamera()
        else statusText.text = "未获得相机权限。请返回激活页，使用“从相册识别二维码”或粘贴激活码。"
    }

    override fun onDestroy() {
        barcodeScanner.close()
        cameraExecutor.shutdown()
        super.onDestroy()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_LICENSE_TOKEN = "licenseToken"
        private const val REQUEST_CAMERA_PERMISSION = 4101
    }
}
