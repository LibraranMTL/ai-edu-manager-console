package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Child JVM deliberately terminates after persisting a synthetic checkpoint. */
object ModelCrashProcessFixture {
    @JvmStatic fun main(args: Array<String>) {
        val directory = File(args.single())
        val sink = object : ModelReceiptSink {
            override fun record(receipt: ModelCallReceipt) {
                File(directory, "receipts.txt").appendText("${receipt.state}\n")
            }
        }
        val transport = ModelTransport { _, _, _, _ ->
            File(directory, "sends.txt").appendText("sent\n")
            val body = JSONObject().put("choices", JSONArray().put(JSONObject().put("finish_reason", "stop")
                .put("message", JSONObject().put("content", "synthetic-result"))))
            ModelHttpResponse(200, body.toString(), "synthetic")
        }
        val provider = CompatibleModelProvider("https://example.org/v1", "synthetic", transport, sink)
        provider.generate(ModelRequest("synthetic-model", JSONArray(), "synthetic-student", "synthetic-task",
            commitValidatedResponse = { result ->
                File(directory, "checkpoint.txt").writeText(result)
                Runtime.getRuntime().halt(23)
            }))
        error("fixture should have terminated")
    }
}
