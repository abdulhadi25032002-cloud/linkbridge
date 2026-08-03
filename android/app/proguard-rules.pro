# Keep WebRTC classes referenced from XML/manifest and JNI.
-keep class org.webrtc.** { *; }
-keepclassmembers class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# CameraX
-keep class androidx.camera.** { *; }
