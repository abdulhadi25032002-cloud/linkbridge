package com.linkbridge.app

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.linkbridge.app.databinding.ActivityMainBinding
import com.linkbridge.app.permissions.Permissions
import com.linkbridge.app.service.RemoteService
import com.linkbridge.app.util.Prefs

/**
 * Entry point. Shows device status and capability gates when paired, and
 * launches the pairing flow from a deep link when not paired. Also runs the
 * per-session permission gate (camera/gallery/screen) on consent requests.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private var pendingSessionId: String? = null
    private var pendingKind: String? = null

    private val captureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK && result.data != null) {
                CaptureState.save(result.resultCode, result.data)
                renderCapabilities()
                onGateFinished()
            }
        }

    private val cameraLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            renderCapabilities()
            onGateFinished()
        }

    private val galleryLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            renderCapabilities()
            onGateFinished()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnSignout.setOnClickListener {
            Prefs.clear(this)
            CaptureState.clear()
            stopService(Intent(this, RemoteService::class.java))
            render()
        }

        handleIntent(intent)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
        render()
    }

    private fun handleIntent(intent: Intent) {
        when (intent.action) {
            ACTION_PREPARE_SESSION -> {
                pendingSessionId = intent.getStringExtra("sessionId")
                pendingKind = intent.getStringExtra("kind")
                runSessionGate()
            }
            Intent.ACTION_VIEW -> {
                val token = intent.data?.getQueryParameter("t")
                if (!token.isNullOrBlank() && token.startsWith("lbpair_")) {
                    if (Prefs.isPaired) {
                        Toast.makeText(this, R.string.status_online, Toast.LENGTH_SHORT).show()
                    } else {
                        startActivity(
                            Intent(this, PairingActivity::class.java)
                                .setData(intent.data)
                                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
                        )
                    }
                }
            }
        }
    }

    // --- Per-session permission gate (camera / gallery / screen) -----------

    private fun runSessionGate() {
        when (pendingKind) {
            "camera" -> {
                if (Permissions.hasCamera(this)) onGateFinished()
                else cameraLauncher.launch(android.Manifest.permission.CAMERA)
            }
            "gallery" -> {
                if (Permissions.hasGallery(this)) onGateFinished()
                else if (Build.VERSION.SDK_INT >= 33) {
                    galleryLauncher.launch(android.Manifest.permission.READ_MEDIA_IMAGES)
                } else {
                    galleryLauncher.launch(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                }
            }
            "screen" -> {
                if (CaptureState.hasCapture()) {
                    onGateFinished()
                } else {
                    val manager = getSystemService(MediaProjectionManager::class.java)
                    captureLauncher.launch(manager.createScreenCaptureIntent())
                }
            }
            else -> onGateFinished()
        }
    }

    private fun onGateFinished() {
        val sessionId = pendingSessionId ?: return
        val kind = pendingKind ?: return
        val ready = when (kind) {
            "camera" -> Permissions.hasCamera(this)
            "gallery" -> Permissions.hasGallery(this)
            "screen" -> CaptureState.hasCapture()
            else -> true
        }
        if (ready) {
            startService(
                Intent(this, RemoteService::class.java)
                    .setAction(RemoteService.ACTION_PREPARE_READY)
                    .putExtra("sessionId", sessionId)
                    .putExtra("kind", kind),
            )
            pendingSessionId = null
            pendingKind = null
        }
    }

    // --- Status UI ----------------------------------------------------------

    private fun render() {
        val paired = Prefs.isPaired
        binding.statusSubtitle.text =
            if (paired) getString(R.string.status_online) else getString(R.string.status_offline)
        binding.pairedAs.text =
            if (paired) getString(R.string.paired_as) else getString(R.string.pair_now)
        binding.btnSignout.visibility = if (paired) View.VISIBLE else View.GONE
        binding.btnPair.visibility = View.GONE
        renderCapabilities()
        if (paired) RemoteService.start(this)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun renderCapabilities() {
        binding.capabilities.removeAllViews()
        addCapabilityRow(
            label = getString(R.string.capability_screen),
            granted = CaptureState.hasCapture(),
            enableLabel = getString(R.string.enable),
            onEnable = {
                val manager = getSystemService(MediaProjectionManager::class.java)
                captureLauncher.launch(manager.createScreenCaptureIntent())
            },
        )
        addCapabilityRow(
            label = getString(R.string.capability_touch),
            granted = Permissions.isAccessibilityEnabled(this),
            enableLabel = getString(R.string.pairing_open_settings),
            onEnable = {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            },
        )
        addCapabilityRow(
            label = getString(R.string.capability_camera),
            granted = Permissions.hasCamera(this),
            enableLabel = getString(R.string.enable),
            onEnable = {
                cameraLauncher.launch(android.Manifest.permission.CAMERA)
            },
        )
        addCapabilityRow(
            label = getString(R.string.capability_gallery),
            granted = Permissions.hasGallery(this),
            enableLabel = getString(R.string.enable),
            onEnable = {
                if (Build.VERSION.SDK_INT >= 33) {
                    galleryLauncher.launch(android.Manifest.permission.READ_MEDIA_IMAGES)
                } else {
                    galleryLauncher.launch(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                }
            },
        )
    }

    private fun addCapabilityRow(
        label: String,
        granted: Boolean,
        enableLabel: String,
        onEnable: () -> Unit,
    ) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(0, 8, 0, 8)
        }

        val statusDot = TextView(this).apply {
            text = if (granted) "✓" else "•"
            setTextColor(
                androidx.core.content.ContextCompat.getColor(
                    this@MainActivity,
                    if (granted) R.color.success else R.color.text_secondary,
                ),
            )
            textSize = 16f
        }
        val labelView = TextView(this).apply {
            text = label
            setTextColor(androidx.core.content.ContextCompat.getColor(this@MainActivity, R.color.text_primary))
            textSize = 15f
            setPadding(16, 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        row.addView(statusDot)
        row.addView(labelView)

        if (!granted) {
            val enable = Button(this).apply {
                text = enableLabel
                isAllCaps = false
                setOnClickListener { onEnable() }
            }
            row.addView(enable)
        }

        binding.capabilities.addView(row)
    }

    companion object {
        const val ACTION_PREPARE_SESSION = "com.linkbridge.app.action.PREPARE_SESSION"
    }
}
