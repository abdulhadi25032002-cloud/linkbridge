package com.linkbridge.app.remote

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Reads the on-device gallery from MediaStore. Runs only after the user
 * granted the gallery permission on first open. Thumbnails and full images
 * are converted to base64 data URLs for the dashboard.
 */
object GalleryProvider {

    data class GalleryImage(
        val id: String,
        val name: String,
        val thumbnailDataUrl: String,
        val width: Int,
        val height: Int,
        val sizeBytes: Long,
        val dateTaken: Long,
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("name", name)
            .put("uri", thumbnailDataUrl)
            .put("width", width)
            .put("height", height)
            .put("sizeBytes", sizeBytes)
            .put("dateTaken", dateTaken)
    }

    private const val MAX_THUMBNAIL = 320
    private const val MAX_FULL = 1600

    fun listImages(context: Context, limit: Int = 60): List<GalleryImage> {
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.DATE_TAKEN,
        )
        val collection = if (Build.VERSION.SDK_INT >= 29) {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }

        val result = mutableListOf<GalleryImage>()
        context.contentResolver.query(
            collection,
            projection,
            null,
            null,
            "${MediaStore.Images.Media.DATE_ADDED} DESC",
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val wCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
            val hCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
            val dateCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)

            while (cursor.moveToNext() && result.size < limit) {
                val id = cursor.getLong(idCol)
                val uri = ContentUris.withAppendedId(collection, id)
                result += GalleryImage(
                    id = id.toString(),
                    name = cursor.getString(nameCol) ?: "image",
                    thumbnailDataUrl = decodeToDataUrl(context, uri, MAX_THUMBNAIL, 70) ?: "",
                    width = cursor.getInt(wCol),
                    height = cursor.getInt(hCol),
                    sizeBytes = cursor.getLong(sizeCol),
                    dateTaken = cursor.getLong(dateCol),
                )
            }
        }
        return result
    }

    fun fullImageDataUrl(context: Context, id: String): String? {
        val collection = if (Build.VERSION.SDK_INT >= 29) {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
        val uri = ContentUris.withAppendedId(collection, id.toLongOrNull() ?: return null)
        return decodeToDataUrl(context, uri, MAX_FULL, 85)
    }

    private fun decodeToDataUrl(context: Context, uri: Uri, maxDim: Int, quality: Int): String? {
        val bounds = context.contentResolver.openInputStream(uri)?.use { input ->
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeStream(input, null, opts)
            opts
        } ?: return null

        val sample = computeSampleSize(bounds.outWidth, bounds.outHeight, maxDim)
        val bitmap = context.contentResolver.openInputStream(uri)?.use { input ->
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            BitmapFactory.decodeStream(input, null, opts)
        } ?: return null

        val scaled = if (max(bitmap.width, bitmap.height) > maxDim) {
            val ratio = maxDim.toFloat() / max(bitmap.width, bitmap.height)
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * ratio).toInt().coerceAtLeast(1),
                (bitmap.height * ratio).toInt().coerceAtLeast(1),
                true,
            )
        } else {
            bitmap
        }

        val bytes = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, bytes)
        val encoded = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
        return "data:image/jpeg;base64,$encoded"
    }

    private fun computeSampleSize(width: Int, height: Int, maxDim: Int): Int {
        var sample = 1
        while (max(width, height) / (sample * 2) >= maxDim) {
            sample *= 2
        }
        return sample
    }

    private fun max(a: Int, b: Int) = if (a > b) a else b
}
