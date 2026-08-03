package com.linkbridge.app

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.linkbridge.app.databinding.ActivityPairingBinding
import com.linkbridge.app.net.ApiClient
import com.linkbridge.app.permissions.Permissions
import com.linkbridge.app.service.RemoteService
import com.linkbridge.app.util.Prefs
import kotlinx.coroutines.launch

/**
 * Guided pairing: consent → required permissions (notifications, screen
 * capture, touch control) → register with the dashboard.
 *
 * The flow never proceeds past a missing permission. After the user returns
 * from an official Android permission screen, setup automatically resumes.
 */
class PairingActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPairingBinding
    private var pairToken: String? = null
    private var completed = false

    private enum class Step(val labelRes: Int) {
        NOTIFICATIONS(com.linkbridge.app.R.string.pairing_step_notifications),
        SCREEN(com.linkbridge.app.R.string.pairing_step_screen),
        ACCESSIBILITY(com.linkbridge.app.R.string.pairing_step_accessibility),
    }

    private val steps = mutableListOf<Step>()
    private var currentStep = 0
    private var gateStarted = false

    private val accessibilityPoller = Handler(Looper.getMainLooper())
    private val accessibilityCheck = object : Runnable {
        override fun run() {
            if (!gateStarted || completed) return
            if (Permissions.isAccessibilityEnabled(this@PairingActivity)) {
                advance()
            } else {
                accessibilityPoller.postDelayed(this, 800)
            }
        }
    }

    private val captureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK && result.data != null) {
                CaptureState.save(result.resultCode, result.data)
                advance()
            } else {
                updateStatus(getString(R.string.pairing_waiting))
                renderSteps()
            }
        }

    private val notificationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            advance()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPairingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        pairToken = intent.data?.getQueryParameter("t")
        if (pairToken.isNullOrBlank() || !pairToken!!.startsWith("lbpair_")) {
            showFailure(getString(R.string.error_token_invalid))
            return
        }

        // Build the ordered list of required permission steps.
        steps += Step.NOTIFICATIONS
        steps += Step.SCREEN
        steps += Step.ACCESSIBILITY

        binding.btnAccept.setOnClickListener {
            gateStarted = true
            binding.btnAccept.visibility = View.GONE
            binding.btnDecline.visibility = View.GONE
            advance()
        }
        binding.btnDecline.setOnClickListener { finish() }
        binding.pairingStatus.text = getString(R.string.pairing_consent)

        renderSteps()
    }

    /**
     * Advances through the permission gates. Each gate only proceeds when
     * the required grant exists; otherwise it opens the official flow.
     */
    private fun advance() {
        if (completed) return
        if (!gateStarted) return

        while (currentStep < steps.size) {
            when (steps[currentStep]) {
                Step.NOTIFICATIONS -> {
                    if (Permissions.hasNotifications(this)) {
                        currentStep++
                        continue
                    }
                    if (Build.VERSION.SDK_INT >= 33) {
                        notificationLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        currentStep++
                    }
                    return
                }
                Step.SCREEN -> {
                    if (CaptureState.hasCapture()) {
                        currentStep++
                        continue
                    }
                    val manager = getSystemService(MediaProjectionManager::class.java)
                    captureLauncher.launch(manager.createScreenCaptureIntent())
                    return
                }
                Step.ACCESSIBILITY -> {
                    if (Permissions.isAccessibilityEnabled(this)) {
                        currentStep++
                        continue
                    }
                    updateStatus(getString(R.string.pairing_waiting))
                    openAccessibilitySettings()
                    accessibilityPoller.post(accessibilityCheck)
                    return
                }
            }
        }

        // All gates satisfied.
        completePairing()
    }

    private fun openAccessibilitySettings() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    override fun onResume() {
        super.onResume()
        // Auto-resume: re-check the current gate whenever we come back.
        if (gateStarted && !completed) {
            renderSteps()
            advance()
        }
    }

    private fun completePairing() {
        if (completed) return
        completed = true
        accessibilityPoller.removeCallbacks(accessibilityCheck)
        updateStatus(getString(R.string.pairing_complete))

        val token = pairToken ?: return
        lifecycleScope.launch {
            try {
                val result = ApiClient.completePairing(
                    token = token,
                    name = Build.MODEL ?: "Android device",
                    model = Build.MODEL ?: "",
                    manufacturer = Build.MANUFACTURER ?: "",
                    androidVersion = Build.VERSION.RELEASE ?: "",
                    appVersion = BuildConfig.VERSION_NAME,
                )
                Prefs.deviceId = result.deviceId
                Prefs.deviceToken = result.deviceToken
                Prefs.deviceName = Build.MODEL ?: "Android device"
                RemoteService.start(this@PairingActivity)
                Toast.makeText(this@PairingActivity, R.string.pairing_complete, Toast.LENGTH_LONG).show()
                finish()
            } catch (e: Exception) {
                completed = false
                showFailure(
                    getString(
                        R.string.pairing_failed,
                        e.message ?: getString(R.string.error_network),
                    ),
                )
            }
        }
    }

    private fun renderSteps() {
        binding.steps.removeAllViews()
        steps.forEachIndexed { index, step ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 0)
            }
            val marker = TextView(this).apply {
                text = when {
                    index < currentStep -> "✓"
                    index == currentStep -> "→"
                    else -> "•"
                }
                setTextColor(
                    when {
                        index < currentStep -> getColorCompat(com.linkbridge.app.R.color.success)
                        index == currentStep -> getColorCompat(com.linkbridge.app.R.color.warning)
                        else -> getColorCompat(com.linkbridge.app.R.color.text_secondary)
                    },
                )
                textSize = 16f
            }
            val label = TextView(this).apply {
                text = getString(step.labelRes)
                setTextColor(getColorCompat(com.linkbridge.app.R.color.text_primary))
                textSize = 14f
                setPadding(16, 0, 0, 0)
            }
            row.addView(marker)
            row.addView(label)
            binding.steps.addView(row)
        }
    }

    private fun updateStatus(text: String) {
        binding.pairingStatus.text = text
    }

    private fun showFailure(message: String) {
        binding.steps.removeAllViews()
        updateStatus(message)
        binding.btnAccept.visibility = View.GONE
        binding.btnDecline.visibility = View.GONE
    }

    override fun onDestroy() {
        accessibilityPoller.removeCallbacks(accessibilityCheck)
        super.onDestroy()
    }

    private fun getColorCompat(color: Int): Int =
        androidx.core.content.ContextCompat.getColor(this, color)
}
