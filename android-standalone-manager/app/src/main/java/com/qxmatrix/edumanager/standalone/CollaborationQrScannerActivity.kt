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

class CollaborationQrScannerActivity : ComponentActivity() {
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val frameInFlight = AtomicBoolean(false)
    private val resultDelivered = AtomicBoolean(false)
    private val scanner by lazy { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildView())
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else requestPermissions(arrayOf(Manifest.permission.CAMERA), REQUEST_CAMERA)
    }

    private fun buildView(): FrameLayout {
        previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        statusText = TextView(this).apply {
            text = "扫描 Windows 主机复制的知识协作连接二维码\n连接内容只在本机解析"
            textSize = 17f; setTextColor(Color.WHITE); setBackgroundColor(0xB3000000.toInt()); gravity = Gravity.CENTER
            setPadding(dp(18), dp(14), dp(18), dp(14))
        }
        return FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(previewView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(LinearLayout(this@CollaborationQrScannerActivity).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(18), dp(24), dp(18), dp(24))
                addView(statusText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                addView(Button(this@CollaborationQrScannerActivity).apply {
                    text = "取消"
                    YouthUi.applyButton(this, UiPreferences(this@CollaborationQrScannerActivity).palette(), YouthButtonRole.PRIMARY)
                    setOnClickListener { finish() }
                })
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        }
    }

    @androidx.annotation.OptIn(markerClass = [androidx.camera.core.ExperimentalGetImage::class])
    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = runCatching { future.get() }.getOrElse { statusText.text = "无法启动摄像头：${it.message ?: "未知错误"}"; return@addListener }
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(cameraExecutor) { proxy ->
                if (!frameInFlight.compareAndSet(false, true)) { proxy.close(); return@setAnalyzer }
                val image = proxy.image
                if (image == null) { frameInFlight.set(false); proxy.close(); return@setAnalyzer }
                scanner.process(InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees))
                    .addOnSuccessListener { values ->
                        val payload = values.asSequence().mapNotNull { CollaborationPairingProtocol.normalizeQrPayload(it.rawValue) }.firstOrNull()
                        if (payload != null && resultDelivered.compareAndSet(false, true)) {
                            setResult(RESULT_OK, Intent().putExtra(EXTRA_CONNECTION_PAYLOAD, payload)); finish()
                        }
                    }
                    .addOnFailureListener { statusText.text = "识别暂时失败，请保持二维码清晰并重试。" }
                    .addOnCompleteListener { frameInFlight.set(false); proxy.close() }
            }
            runCatching { provider.unbindAll(); provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis) }
                .onFailure { statusText.text = "摄像头不可用：${it.message ?: "未知错误"}" }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CAMERA && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startCamera()
        else if (requestCode == REQUEST_CAMERA) statusText.text = "未获得相机权限，请返回后粘贴完整连接信息。"
    }

    override fun onDestroy() { scanner.close(); cameraExecutor.shutdown(); super.onDestroy() }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_CONNECTION_PAYLOAD = "collaborationConnectionPayload"
        private const val REQUEST_CAMERA = 5101
    }
}
