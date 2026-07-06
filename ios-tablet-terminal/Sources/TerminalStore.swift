import Foundation
import SwiftUI
import UIKit

@MainActor
final class TerminalStore: ObservableObject {
    @Published var settings: TerminalSettings = TerminalSettings()
    @Published var students: [Student] = []
    @Published var selectedStudentID: String = ""
    @Published var archiveFiles: [ArchiveFile] = []
    @Published var selectedArchiveCategory: ArchiveCategory = .report
    @Published var selectedArchivePath: String = ""
    @Published var markdownContent: String = ""
    @Published var statusMessage: String = "尚未连接主机。"
    @Published var connectionPanelVisible: Bool = false
    @Published var isBusy: Bool = false
    @Published var lastUpdateMessage: String = ""

    private let api = HostAPI()
    private let settingsKey = "com.qxmatrix.eduterminal.ios.settings"
    private let cachePrefix = "com.qxmatrix.eduterminal.ios.markdown."
    private let archiveListCachePrefix = "com.qxmatrix.eduterminal.ios.archiveList."

    init() {
        loadSettings()
    }

    var selectedStudent: Student? {
        if let found = students.first(where: { $0.id == selectedStudentID }) { return found }
        return students.first
    }

    var baseURL: String {
        switch settings.connectionMode {
        case .manualRemote:
            return settings.remoteURL.isEmpty ? settings.serverURL : settings.remoteURL
        case .lanOnly, .lanAndTailscale:
            return settings.serverURL
        }
    }

    var filteredArchiveFiles: [ArchiveFile] {
        archiveFiles.filter { file in
            selectedArchiveCategory == .all || classify(file) == selectedArchiveCategory
        }
    }

    func saveSettings() {
        if let data = try? JSONEncoder().encode(settings) {
            UserDefaults.standard.set(data, forKey: settingsKey)
        }
    }

    func loadSettings() {
        guard let data = UserDefaults.standard.data(forKey: settingsKey),
              let decoded = try? JSONDecoder().decode(TerminalSettings.self, from: data) else {
            return
        }
        settings = decoded
    }

    func parseAndApplyPairText(_ text: String) {
        if let payload = parsePairPayload(text) {
            if let url = payload.serverUrl, !url.isEmpty { settings.serverURL = url }
            if let tailscale = payload.tailscaleUrl, !tailscale.isEmpty { settings.remoteURL = tailscale }
            if let first = payload.tailscaleUrls?.first, settings.remoteURL.isEmpty { settings.remoteURL = first }
            if let pairCode = payload.pairCode, !pairCode.isEmpty {
                Task { await pair(pairCode: pairCode) }
            } else {
                saveSettings()
                statusMessage = "已读取主机地址，请输入或扫码配对码。"
            }
        } else {
            statusMessage = "无法识别配对信息，请确认复制的是 Windows 主机二维码内容。"
        }
    }

    func pair(pairCode: String) async {
        guard !baseURL.isEmpty else {
            statusMessage = "请先填写主机服务地址。"
            return
        }
        await runBusy("正在绑定主机...") {
            let response = try await api.pair(baseURL: baseURL, pairCode: pairCode, deviceID: settings.deviceID, deviceName: settings.deviceName)
            guard response.ok, let token = response.token else {
                throw HostAPIError.badResponse(response.message ?? "绑定失败。")
            }
            settings.apiToken = token
            settings.lastConnectedAt = ISO8601DateFormatter().string(from: Date())
            students = response.students ?? []
            selectedStudentID = students.first?.id ?? ""
            saveSettings()
            statusMessage = "已绑定主机，读取到 \(students.count) 名学生。"
        }
    }

    func testConnectionAndLoadStudents() async {
        guard !baseURL.isEmpty else {
            statusMessage = "请先填写主机服务地址。"
            return
        }
        guard !settings.apiToken.isEmpty else {
            statusMessage = "请先扫码绑定主机，获取设备 token。"
            return
        }
        await runBusy("正在连接主机...") {
            let response = try await api.students(baseURL: baseURL, token: settings.apiToken)
            students = response.students
            if selectedStudentID.isEmpty || !students.contains(where: { $0.id == selectedStudentID }) {
                selectedStudentID = students.first?.id ?? ""
            }
            settings.lastConnectedAt = ISO8601DateFormatter().string(from: Date())
            saveSettings()
            statusMessage = "连接正常，已读取 \(students.count) 名学生。"
        }
    }

    func upload(data: Data, filename: String) async {
        guard let student = selectedStudent else {
            statusMessage = "请先选择学生。"
            return
        }
        guard !settings.apiToken.isEmpty else {
            statusMessage = "请先绑定主机。"
            return
        }
        await runBusy("正在上传资料...") {
            let response = try await api.upload(baseURL: baseURL, token: settings.apiToken, studentID: student.id, data: data, filename: filename, mimeType: mimeType(for: filename))
            if !response.ok { throw HostAPIError.badResponse(response.message ?? "上传失败。") }
            statusMessage = "已上传：\(filename)。请在 Windows 端确认待消化资料。"
            await testConnectionAndLoadStudents()
        }
    }

    func refreshArchiveFiles() async {
        guard let student = selectedStudent else { return }
        guard !settings.apiToken.isEmpty else {
            statusMessage = "请先绑定主机。"
            return
        }
        await runBusy("正在刷新档案...") {
            do {
                let response = try await api.archiveFiles(baseURL: baseURL, token: settings.apiToken, studentID: student.id)
                archiveFiles = response.files
                cacheArchiveFiles(studentID: student.id, files: response.files)
                selectedArchivePath = filteredArchiveFiles.first?.path ?? ""
                statusMessage = "已读取 \(archiveFiles.count) 个 Markdown 档案。"
            } catch {
                archiveFiles = cachedArchiveFiles(studentID: student.id)
                selectedArchivePath = filteredArchiveFiles.first?.path ?? ""
                if archiveFiles.isEmpty { throw error }
                statusMessage = "网络不可用，已显示最近档案列表。"
            }
            if let first = filteredArchiveFiles.first {
                await loadArchive(first)
            }
        }
    }

    func loadArchive(_ file: ArchiveFile) async {
        guard let student = selectedStudent else { return }
        selectedArchivePath = file.path
        await runBusy("正在读取正文...") {
            do {
                let response = try await api.archiveFile(baseURL: baseURL, token: settings.apiToken, studentID: student.id, path: file.path)
                let content = response.content ?? ""
                markdownContent = content
                cacheMarkdown(studentID: student.id, path: file.path, content: content)
                statusMessage = "已打开：\(file.name)"
            } catch {
                let cached = cachedMarkdown(studentID: student.id, path: file.path)
                if cached.isEmpty { throw error }
                markdownContent = cached
                statusMessage = "网络不可用，已显示离线缓存：\(file.name)"
            }
        }
    }

    func checkUpdate() async {
        await runBusy("正在检查更新...") {
            let manifest = try await api.checkUpdate()
            let remoteCode = manifest.iosVersionCode ?? 0
            if remoteCode > appVersionCode, let url = URL(string: manifest.iosUrl ?? "") {
                lastUpdateMessage = "发现 iOS 新版 \(manifest.iosVersionName ?? "")。"
                UIApplication.shared.open(url)
            } else {
                lastUpdateMessage = "当前 iOS 终端已是最新版本 v\(appVersionName)。"
            }
            statusMessage = lastUpdateMessage
        }
    }

    func openTailscale() {
        if let scheme = URL(string: "tailscale://"), UIApplication.shared.canOpenURL(scheme) {
            UIApplication.shared.open(scheme)
        } else {
            UIApplication.shared.open(tailscaleDownloadURL)
        }
    }

    func tailscaleInstalled() -> Bool {
        guard let url = URL(string: "tailscale://") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    func copy(_ text: String) {
        UIPasteboard.general.string = text
        statusMessage = "已复制。"
    }

    private func runBusy(_ message: String, operation: () async throws -> Void) async {
        isBusy = true
        statusMessage = message
        defer { isBusy = false }
        do {
            try await operation()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func parsePairPayload(_ text: String) -> PairPayload? {
        if let data = text.data(using: .utf8),
           let payload = try? JSONDecoder().decode(PairPayload.self, from: data) {
            return payload
        }
        var payload = PairPayload()
        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<eq]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if key == "serverUrl" { payload.serverUrl = value }
            if key == "pairCode" { payload.pairCode = value }
            if key == "tailscaleUrl" { payload.tailscaleUrl = value }
            if key == "tailscaleUrls" { payload.tailscaleUrls = value.split(separator: ",").map(String.init) }
        }
        return payload.serverUrl == nil && payload.pairCode == nil ? nil : payload
    }

    private func classify(_ file: ArchiveFile) -> ArchiveCategory {
        let name = file.name.lowercased()
        let haystack = "\(file.path.lowercased())/\(name)"
        if name == "index.md" { return .other }
        if haystack.contains("摘要") || haystack.contains("summary") || haystack.contains("digest") { return .summary }
        if haystack.contains("问答") || haystack.contains("qa") || haystack.contains("q&a") || haystack.contains("对话") || haystack.contains("咨询") || haystack.contains("精华") { return .qa }
        if haystack.contains("综合") || haystack.contains("学情") || haystack.contains("汇总") || haystack.contains("分析") || haystack.contains("report") || haystack.contains("overview") { return .report }
        return .other
    }

    private func cacheMarkdown(studentID: String, path: String, content: String) {
        UserDefaults.standard.set(content, forKey: cachePrefix + studentID + "." + path)
    }

    private func cachedMarkdown(studentID: String, path: String) -> String {
        UserDefaults.standard.string(forKey: cachePrefix + studentID + "." + path) ?? ""
    }

    private func cacheArchiveFiles(studentID: String, files: [ArchiveFile]) {
        if let data = try? JSONEncoder().encode(files) {
            UserDefaults.standard.set(data, forKey: archiveListCachePrefix + studentID)
        }
    }

    private func cachedArchiveFiles(studentID: String) -> [ArchiveFile] {
        guard let data = UserDefaults.standard.data(forKey: archiveListCachePrefix + studentID),
              let files = try? JSONDecoder().decode([ArchiveFile].self, from: data) else {
            return []
        }
        return files
    }
}
