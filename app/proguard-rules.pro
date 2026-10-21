-keepclassmembers class com.sandeep.posterforge.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes RuntimeVisibleAnnotations,JavascriptInterface
# Tink (used by EncryptedSharedPreferences) references compile-only annotations.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
