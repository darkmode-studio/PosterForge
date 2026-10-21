package com.sandeep.posterforge

import android.content.Context
import android.graphics.Bitmap
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import java.util.concurrent.TimeUnit

/** On-device ML Kit Subject Segmentation. The model is delivered by Google Play services (downloaded once, then offline). */
class MlKitSegmenter(private val ctx: Context) : SubjectLift.Segmenter {
    override fun foreground(src: Bitmap): Bitmap? {
        if (!playServicesOk(ctx)) throw SubjectLift.Unavailable("no_play_services", "Subject lift needs Google Play services, which this phone does not have")
        val seg = SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundBitmap().build())
        try {
            // make sure the model module is installed (first use downloads ~5-10 MB through Play services)
            try {
                val mi = ModuleInstall.getClient(ctx)
                val avail = Tasks.await(mi.areModulesAvailable(seg), 20, TimeUnit.SECONDS)
                if (!avail.areModulesAvailable()) {
                    Tasks.await(mi.installModules(ModuleInstallRequest.newBuilder().addApi(seg).build()), 120, TimeUnit.SECONDS)
                }
            } catch (e: java.util.concurrent.TimeoutException) {
                throw SubjectLift.Unavailable("model_downloading", "The subject model is still downloading. Try again in a minute (needs internet once)")
            } catch (_: Exception) { /* fall through: process() reports the real state */ }
            val res = try { Tasks.await(seg.process(InputImage.fromBitmap(src, 0)), 60, TimeUnit.SECONDS) }
            catch (e: java.util.concurrent.ExecutionException) {
                val c = e.cause
                if (c is MlKitException && c.errorCode == MlKitException.UNAVAILABLE)
                    throw SubjectLift.Unavailable("model_downloading", "The subject model is still downloading. Try again in a minute (needs internet once)")
                throw SubjectLift.Unavailable("unavailable", c?.message ?: "Subject lift is not available on this phone")
            }
            return res.foregroundBitmap
        } finally { seg.close() }
    }

    companion object {
        fun playServicesOk(ctx: Context): Boolean = try {
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx) == ConnectionResult.SUCCESS
        } catch (_: Throwable) { false }
    }
}
