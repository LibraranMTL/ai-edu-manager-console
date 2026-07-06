import Foundation
import UniformTypeIdentifiers

enum HostAPIError: LocalizedError {
    case invalidBaseURL
    case missingToken
    case badResponse(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: return "主机地址无效。"
        case .missingToken: return "尚未绑定设备 token。"
        case .badResponse(let message): return message
        }
    }
}

struct HostAPI {
    func health(baseURL: String) async throws -> GenericResponse {
        try await request(baseURL: baseURL, token: nil, path: "/api/health", method: "GET")
    }

    func pair(baseURL: String, pairCode: String, deviceID: String, deviceName: String) async throws -> PairConfirmResponse {
        let body = [
            "pairCode": pairCode,
            "deviceId": deviceID,
            "deviceName": deviceName
        ]
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await request(baseURL: baseURL, token: nil, path: "/api/pair/confirm", method: "POST", body: data, contentType: "application/json")
    }

    func students(baseURL: String, token: String) async throws -> HostStudentsResponse {
        try await request(baseURL: baseURL, token: token, path: "/api/students", method: "GET")
    }

    func archiveFiles(baseURL: String, token: String, studentID: String) async throws -> ArchiveFilesResponse {
        try await request(baseURL: baseURL, token: token, path: "/api/students/\(studentID)/archive/files", method: "GET")
    }

    func archiveFile(baseURL: String, token: String, studentID: String, path: String) async throws -> ArchiveFileResponse {
        var components = try components(baseURL: baseURL, path: "/api/students/\(studentID)/archive/file")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        guard let url = components.url else { throw HostAPIError.invalidBaseURL }
        return try await request(url: url, token: token, method: "GET")
    }

    func upload(baseURL: String, token: String, studentID: String, data: Data, filename: String, mimeType: String) async throws -> GenericResponse {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        body.appendString("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.appendString("\r\n--\(boundary)--\r\n")
        return try await request(
            baseURL: baseURL,
            token: token,
            path: "/api/students/\(studentID)/materials",
            method: "POST",
            body: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        )
    }

    func checkUpdate() async throws -> UpdateManifest {
        let (data, _) = try await URLSession.shared.data(from: updateManifestURL)
        return try JSONDecoder().decode(UpdateManifest.self, from: data)
    }

    private func request<T: Decodable>(baseURL: String, token: String?, path: String, method: String, body: Data? = nil, contentType: String? = nil) async throws -> T {
        let url = try components(baseURL: baseURL, path: path).url
        guard let url else { throw HostAPIError.invalidBaseURL }
        return try await request(url: url, token: token, method: method, body: body, contentType: contentType)
    }

    private func request<T: Decodable>(url: URL, token: String?, method: String, body: Data? = nil, contentType: String? = nil) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status < 200 || status >= 300 {
            let message = (try? JSONDecoder().decode(GenericResponse.self, from: data).message) ?? "请求失败：HTTP \(status)"
            throw HostAPIError.badResponse(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func components(baseURL: String, path: String) throws -> URLComponents {
        guard let base = URL(string: normalizedBaseURL(baseURL)) else { throw HostAPIError.invalidBaseURL }
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        components?.path = path
        guard let components else { throw HostAPIError.invalidBaseURL }
        return components
    }

    private func normalizedBaseURL(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            return trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
        return "http://\(trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/")))"
    }
}

extension Data {
    mutating func appendString(_ value: String) {
        append(Data(value.utf8))
    }
}

func mimeType(for filename: String) -> String {
    let ext = (filename as NSString).pathExtension
    if let type = UTType(filenameExtension: ext)?.preferredMIMEType {
        return type
    }
    if ["jpg", "jpeg"].contains(ext.lowercased()) { return "image/jpeg" }
    if ext.lowercased() == "png" { return "image/png" }
    if ext.lowercased() == "md" { return "text/markdown" }
    return "application/octet-stream"
}
