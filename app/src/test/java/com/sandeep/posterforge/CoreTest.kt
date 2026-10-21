package com.sandeep.posterforge

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CoreTest {
    private lateinit var server: MockWebServer
    @Before fun up() { server = MockWebServer(); server.start() }
    @After fun down() { server.shutdown() }
    private val base get() = server.url("/").toString().trimEnd('/')
    private val body = """{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}"""

    @Test fun geminiSendsKeyInHeaderNotUrl() {
        server.enqueue(MockResponse().setBody("""{"candidates":[{"content":{"parts":[{"text":"Hello "},{"text":"world"}]}}]}"""))
        val r = Gemini.call("AIzaSECRET", "gemini-2.5-flash", body, base)
        assertTrue(r.getBoolean("ok")); assertEquals("Hello world", r.getString("text"))
        val req = server.takeRequest()
        assertEquals("AIzaSECRET", req.getHeader("x-goog-api-key"))
        assertEquals("/v1beta/models/gemini-2.5-flash:generateContent", req.path)
        assertFalse(req.path!!.contains("SECRET"))
        assertEquals("hi", JSONObject(req.body.readUtf8()).getJSONArray("contents").getJSONObject(0).getJSONArray("parts").getJSONObject(0).getString("text"))
    }

    @Test fun geminiRejectsBadModelName() {
        server.enqueue(MockResponse().setBody("""{"candidates":[{"content":{"parts":[{"text":"x"}]}}]}"""))
        Gemini.call("k", "../../evil?x=", body, base)
        assertEquals("/v1beta/models/gemini-3.8-flash:generateContent", server.takeRequest().path)
    }

    @Test fun geminiErrorMessageSurfaced() {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":{"code":400,"message":"API key not valid"}}"""))
        val r = Gemini.call("bad", "gemini-2.5-flash", body, base)
        assertFalse(r.getBoolean("ok")); assertEquals("API key not valid", r.getString("error")); assertEquals(400, r.getInt("status"))
    }

    @Test fun geminiNoKeyNoRequest() {
        val r = Gemini.call("", "gemini-2.5-flash", body, base)
        assertEquals("NO_KEY", r.getString("error")); assertEquals(0, server.requestCount)
    }

    @Test fun geminiEmptyReply() {
        server.enqueue(MockResponse().setBody("""{"candidates":[]}"""))
        assertFalse(Gemini.call("k", "gemini-2.5-flash", body, base).getBoolean("ok"))
    }

    @Test fun keyHintNeverRevealsKey() {
        assertEquals("••••WXYZ", NativeBridge.hint("AIzaSyABCDEFWXYZ"))
        assertEquals("", NativeBridge.hint(""))
        assertEquals("••••", NativeBridge.hint("short"))
    }

    @Test fun safeFileNames() {
        assertEquals("PosterForge_1.png", NativeBridge.safeName("PosterForge_1.png"))
        assertEquals(".._.._etc_passwd", NativeBridge.safeName("../../etc/passwd"))
        assertEquals("posterforge", NativeBridge.safeName(""))
    }

    private val okReply = """{"candidates":[{"content":{"parts":[{"text":"done"}]}}]}"""

    @Test fun fallbackUsesModelSuggestedByRetiredError() {
        // the exact error Sandeep saw on the phone
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":{"code":404,"message":"models/gemini-2.0-flash is no longer available, use models/gemini-3.8-flash"}}"""))
        server.enqueue(MockResponse().setBody(okReply))
        val r = Gemini.callWithFallback("k", "gemini-2.0-flash", body, base)
        assertTrue(r.getBoolean("ok")); assertEquals("gemini-3.8-flash", r.getString("model")); assertEquals("gemini-2.0-flash", r.getString("fellBackFrom"))
        assertEquals("/v1beta/models/gemini-2.0-flash:generateContent", server.takeRequest().path)
        assertEquals("/v1beta/models/gemini-3.8-flash:generateContent", server.takeRequest().path)
    }

    @Test fun fallbackWalksDefaultsWhenNoSuggestion() {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":{"code":404,"message":"models/gemini-3.8-flash is not found for API version v1beta"}}"""))
        server.enqueue(MockResponse().setBody(okReply))
        val r = Gemini.callWithFallback("k", "", body, base)
        assertTrue(r.getBoolean("ok")); assertEquals(Gemini.DEFAULT_MODELS[1], r.getString("model"))
        assertEquals(2, server.requestCount)
    }

    @Test fun noFallbackOnBadKeyOrQuota() {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}"""))
        val r = Gemini.callWithFallback("bad", "gemini-3.8-flash", body, base)
        assertFalse(r.getBoolean("ok")); assertEquals(1, server.requestCount)
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":{"code":429,"message":"Resource has been exhausted"}}"""))
        assertFalse(Gemini.callWithFallback("k", "gemini-3.8-flash", body, base).getBoolean("ok")); assertEquals(2, server.requestCount)
    }

    @Test fun fallbackGivesUpAfterMaxTries() {
        repeat(6) { server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":{"code":404,"message":"model not found"}}""")) }
        val r = Gemini.callWithFallback("k", "gemini-9-flash", body, base, maxTries = 3)
        assertFalse(r.getBoolean("ok")); assertEquals(3, server.requestCount); assertEquals(3, r.getJSONArray("tried").length())
    }

    @Test fun listModelsFiltersToTextGenerationAndPages() {
        server.enqueue(MockResponse().setBody("""{"models":[
            {"name":"models/gemini-3.8-flash","displayName":"Gemini 3.8 Flash","supportedGenerationMethods":["generateContent","countTokens"]},
            {"name":"models/gemini-3.8-flash-tts","supportedGenerationMethods":["generateContent"]},
            {"name":"models/gemini-embedding-001","supportedGenerationMethods":["embedContent"]},
            {"name":"models/gemini-3.1-flash-image","supportedGenerationMethods":["generateContent"]}],"nextPageToken":"p2"}"""))
        server.enqueue(MockResponse().setBody("""{"models":[{"name":"models/gemini-3.5-flash-lite","supportedGenerationMethods":["generateContent"]},{"name":"models/veo-3.1","supportedGenerationMethods":["predictLongRunning"]}]}"""))
        val r = Gemini.listModels("AIzaSECRET", base)
        assertTrue(r.getBoolean("ok"))
        val ids = (0 until r.getJSONArray("models").length()).map { r.getJSONArray("models").getJSONObject(it).getString("id") }
        assertEquals(listOf("gemini-3.8-flash", "gemini-3.5-flash-lite"), ids)
        val first = server.takeRequest(); assertEquals("AIzaSECRET", first.getHeader("x-goog-api-key")); assertFalse(first.path!!.contains("SECRET"))
        assertTrue(server.takeRequest().path!!.contains("pageToken=p2"))
    }

    @Test fun suggestedModelParsing() {
        assertEquals("gemini-3.8-flash", Gemini.suggested("models/gemini-2.0-flash is no longer available, use models/gemini-3.8-flash"))
        assertNull(Gemini.suggested("API key not valid"))
        assertTrue(Gemini.isUnavailable(404, "")); assertFalse(Gemini.isUnavailable(429, "quota")); assertFalse(Gemini.isUnavailable(400, "API key not valid"))
    }
}
