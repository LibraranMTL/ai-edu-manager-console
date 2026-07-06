import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var store: TerminalStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var section: AppSection = .home

    private var phoneLayout: Bool {
        if store.settings.layoutMode == .phonePortrait { return true }
        if store.settings.layoutMode == .tabletLandscape { return false }
        return horizontalSizeClass == .compact
    }

    var body: some View {
        ZStack {
            SkinBackground(skin: store.settings.skin)
            if phoneLayout {
                TabView(selection: $section) {
                    ForEach(AppSection.allCases) { item in
                        NavigationStack {
                            screen(for: item)
                        }
                        .tabItem { Label(item.title, systemImage: item.systemImage) }
                        .tag(item)
                    }
                }
                .tint(store.settings.skin.tint)
            } else {
                NavigationSplitView {
                    List(AppSection.allCases, selection: $section) { item in
                        Label(item.title, systemImage: item.systemImage)
                            .tag(item)
                    }
                    .navigationTitle("AI教育管家")
                } detail: {
                    screen(for: section)
                }
                .tint(store.settings.skin.tint)
            }
            if store.isBusy {
                ProgressView(store.statusMessage)
                    .padding()
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    @ViewBuilder
    private func screen(for section: AppSection) -> some View {
        switch section {
        case .home:
            HomeView(section: $section)
        case .upload:
            UploadView()
        case .archive:
            ArchiveView()
        case .contact:
            ContactView()
        case .status:
            ConnectionStatusView()
        case .settings:
            SettingsView()
        }
    }
}

struct SkinBackground: View {
    let skin: AppSkin

    var body: some View {
        ZStack {
            skin.pale.ignoresSafeArea()
            Image(skin.imageName)
                .resizable()
                .scaledToFill()
                .opacity(0.12)
                .ignoresSafeArea()
            Rectangle()
                .fill(.white.opacity(0.72))
                .ignoresSafeArea()
        }
    }
}

struct HomeView: View {
    @EnvironmentObject private var store: TerminalStore
    @Binding var section: AppSection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeaderCard()
                card {
                    Text("常用操作").font(.headline)
                    HStack {
                        Button("上传资料到主机") { section = .upload }
                            .buttonStyle(PrimaryButtonStyle(skin: store.settings.skin))
                        Button("查看学情档案") { section = .archive }
                            .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                        Button("联系教育管家") { section = .contact }
                            .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                    }
                    .buttonStyle(.bordered)
                }
                card {
                    Button(store.connectionPanelVisible ? "收起连接设置" : "显示连接设置") {
                        store.connectionPanelVisible.toggle()
                    }
                    .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                    if store.connectionPanelVisible {
                        ConnectionSettingsFields()
                    }
                }
                StatusStrip()
            }
            .padding()
        }
        .navigationTitle("首页")
    }
}

struct HeaderCard: View {
    @EnvironmentObject private var store: TerminalStore

    var body: some View {
        card {
            HStack(spacing: 14) {
                Image("BrandLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                VStack(alignment: .leading, spacing: 4) {
                    Text("AI教育管家平板终端")
                        .font(.title.bold())
                    Text("连接 Windows 主机服务，用于上传学习资料和查看学情档案。版本 v\(appVersionName)")
                        .foregroundStyle(.secondary)
                    Text("嘉玛蓝（北京）科技有限公司版权所有")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    HStack {
                        Link("用户协议", destination: userAgreementURL)
                        Link("隐私政策", destination: privacyPolicyURL)
                    }
                    .font(.footnote)
                    .tint(store.settings.skin.tint)
                }
                Spacer()
            }
        }
    }
}

struct ConnectionSettingsFields: View {
    @EnvironmentObject private var store: TerminalStore
    @State private var pairText = ""
    @State private var pairCode = ""
    @State private var showQRScanner = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("连接模式", selection: $store.settings.connectionMode) {
                ForEach(ConnectionMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .onChange(of: store.settings.connectionMode) { _ in store.saveSettings() }
            TextField("主机服务地址，例如 http://192.168.1.10:18777", text: $store.settings.serverURL)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
                .onChange(of: store.settings.serverURL) { _ in store.saveSettings() }
            TextField("Tailscale 或远程主机地址", text: $store.settings.remoteURL)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
                .onChange(of: store.settings.remoteURL) { _ in store.saveSettings() }
            SecureField("API Token（扫码绑定后自动填写）", text: $store.settings.apiToken)
                .textFieldStyle(.roundedBorder)
                .onChange(of: store.settings.apiToken) { _ in store.saveSettings() }
            HStack {
                TextField("配对码", text: $pairCode)
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)
                Button("绑定") {
                    Task { await store.pair(pairCode: pairCode) }
                }
                .buttonStyle(PrimaryButtonStyle(skin: store.settings.skin))
            }
            TextEditor(text: $pairText)
                .frame(minHeight: 90)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
            HStack {
                Button("解析粘贴的连接信息") { store.parseAndApplyPairText(pairText) }
                    .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                Button("扫码绑定主机") { showQRScanner = true }
                    .buttonStyle(PrimaryButtonStyle(skin: store.settings.skin))
                Button("连接主机") {
                    Task { await store.testConnectionAndLoadStudents() }
                }
                .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
            }
            .sheet(isPresented: $showQRScanner) {
                QRScannerView { code in
                    showQRScanner = false
                    store.parseAndApplyPairText(code)
                }
            }
        }
    }
}

struct UploadView: View {
    @EnvironmentObject private var store: TerminalStore
    @State private var showFileImporter = false
    @State private var showCamera = false
    @State private var selectedPhoto: PhotosPickerItem?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StudentPicker()
                card {
                    Text("上传资料到主机").font(.headline)
                    Text("支持文件、图片和拍照上传。上传后资料会进入当前学生的原始资料库。")
                        .foregroundStyle(.secondary)
                    VStack(spacing: 10) {
                        Button("选择文件上传") { showFileImporter = true }
                            .buttonStyle(PrimaryButtonStyle(skin: store.settings.skin))
                        PhotosPicker(selection: $selectedPhoto, matching: .images) {
                            Text("选择图片/截图上传")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                        Button("拍照上传") { showCamera = true }
                            .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                    }
                }
                StatusStrip()
            }
            .padding()
        }
        .navigationTitle("上传资料到主机")
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            Task { await handleFiles(result) }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { imageData in
                Task { await store.upload(data: imageData, filename: "camera-\(Int(Date().timeIntervalSince1970)).jpg") }
            }
        }
        .onChange(of: selectedPhoto) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    await store.upload(data: data, filename: "photo-\(Int(Date().timeIntervalSince1970)).jpg")
                }
            }
        }
    }

    private func handleFiles(_ result: Result<[URL], Error>) async {
        guard case .success(let urls) = result else {
            store.statusMessage = "未选择文件。"
            return
        }
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) {
                await store.upload(data: data, filename: url.lastPathComponent)
            }
        }
    }
}

struct ArchiveView: View {
    @EnvironmentObject private var store: TerminalStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StudentPicker()
                card {
                    HStack {
                        Text("学情档案").font(.headline)
                        Spacer()
                        Button("刷新档案") { Task { await store.refreshArchiveFiles() } }
                            .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                    }
                    Picker("分类", selection: $store.selectedArchiveCategory) {
                        ForEach(ArchiveCategory.allCases) { category in
                            Text(category.title).tag(category)
                        }
                    }
                    .pickerStyle(.segmented)
                    let files = store.filteredArchiveFiles
                    if files.isEmpty {
                        Text("暂无 Markdown 档案。").foregroundStyle(.secondary)
                    } else {
                        Picker("文件", selection: $store.selectedArchivePath) {
                            ForEach(files) { file in
                                Text(file.path).tag(file.path)
                            }
                        }
                        .onChange(of: store.selectedArchivePath) { path in
                            if let file = files.first(where: { $0.path == path }) {
                                Task { await store.loadArchive(file) }
                            }
                        }
                    }
                }
                card {
                    Text(store.selectedArchivePath.isEmpty ? "正文" : store.selectedArchivePath)
                        .font(.headline)
                    ScrollView {
                        Text(store.markdownContent.isEmpty ? "选择档案后显示 Markdown 正文。" : store.markdownContent)
                            .font(.body.monospaced())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(minHeight: 380)
                }
                StatusStrip()
            }
            .padding()
        }
        .navigationTitle("查看学情档案")
    }
}

struct ContactView: View {
    @EnvironmentObject private var store: TerminalStore

    private var channel: String {
        store.selectedStudent?.remoteChannel?.lowercased() ?? "none"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StudentPicker()
                card {
                    Text("联系教育管家").font(.headline)
                    Text(instruction)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("打开企业微信") { open("wxwork://") }
                            .disabled(channel == "qq" || channel == "none")
                            .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                        Button("打开 QQ") { open("mqq://") }
                            .disabled(channel == "wecom" || channel == "none")
                            .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                    }
                    HStack {
                        Button("复制咨询提示") {
                            store.copy("/咨询，我想咨询")
                        }
                        .buttonStyle(PrimaryButtonStyle(skin: store.settings.skin))
                        Button("复制消化提示") {
                            let name = store.selectedStudent?.name ?? "该学生"
                            store.copy("/消化\(name)原始资料库中的新资料")
                        }
                        .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                    }
                    if let note = store.selectedStudent?.remoteNote, !note.isEmpty {
                        Text(note).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                StatusStrip()
            }
            .padding()
        }
        .navigationTitle("联系教育管家")
    }

    private var instruction: String {
        switch channel {
        case "qq": return "请在 QQ 中联系 AI教育管家，复制咨询提示。"
        case "wecom": return "请在企业微信中联系 AI教育管家，复制咨询提示。"
        case "both": return "请在企业微信或 QQ 中联系 AI教育管家，复制咨询提示。"
        default: return "选择学生后，可查看该学生绑定的企业微信或 QQ 联系入口。"
        }
    }

    private func open(_ value: String) {
        guard let url = URL(string: value) else { return }
        UIApplication.shared.open(url)
    }
}

struct ConnectionStatusView: View {
    @EnvironmentObject private var store: TerminalStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StatusStrip()
                card {
                    Text("连接状态").font(.headline)
                    row("主机地址", store.settings.serverURL.isEmpty ? "未设置" : store.settings.serverURL)
                    row("远程地址", store.settings.remoteURL.isEmpty ? "未设置" : store.settings.remoteURL)
                    row("连接模式", store.settings.connectionMode.title)
                    row("设备 Token", store.settings.apiToken.isEmpty ? "未绑定" : "\(store.settings.apiToken.prefix(8))...")
                    row("学生数量", "\(store.students.count)")
                    row("最后连接", store.settings.lastConnectedAt.isEmpty ? "暂无" : store.settings.lastConnectedAt)
                    row("Tailscale", store.tailscaleInstalled() ? "已安装" : "未检测到")
                }
            }
            .padding()
        }
        .navigationTitle("连接状态")
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).bold()
        }
        .font(.subheadline)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: TerminalStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                card {
                    Text("系统设置").font(.headline)
                    Picker("页面布局", selection: $store.settings.layoutMode) {
                        ForEach(LayoutMode.allCases) { mode in Text(mode.title).tag(mode) }
                    }
                    .onChange(of: store.settings.layoutMode) { _ in store.saveSettings() }
                    Picker("界面皮肤", selection: $store.settings.skin) {
                        ForEach(AppSkin.allCases) { skin in Text(skin.title).tag(skin) }
                    }
                    .onChange(of: store.settings.skin) { _ in store.saveSettings() }
                    Picker("连接模式", selection: $store.settings.connectionMode) {
                        ForEach(ConnectionMode.allCases) { mode in Text(mode.title).tag(mode) }
                    }
                    .onChange(of: store.settings.connectionMode) { _ in store.saveSettings() }
                }
                card {
                    Text("版本与网络").font(.headline)
                    row("iOS 终端版本", "v\(appVersionName) build \(appVersionCode)")
                    row("Tailscale", store.tailscaleInstalled() ? "已安装" : "未检测到")
                    HStack {
                        Button("检查更新") { Task { await store.checkUpdate() } }
                            .buttonStyle(PrimaryButtonStyle(skin: store.settings.skin))
                        Button(store.tailscaleInstalled() ? "打开 Tailscale" : "下载 Tailscale") {
                            store.openTailscale()
                        }
                        .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
                        Link("安装说明", destination: tailscaleInstallGuideURL)
                    }
                }
                card {
                    Text("法律与服务条款").font(.headline)
                    HStack {
                        Link("用户协议", destination: userAgreementURL)
                        Link("隐私政策", destination: privacyPolicyURL)
                    }
                    .tint(store.settings.skin.tint)
                }
                StatusStrip()
            }
            .padding()
        }
        .navigationTitle("系统设置")
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).bold()
        }
    }
}

struct StudentPicker: View {
    @EnvironmentObject private var store: TerminalStore

    var body: some View {
        card {
            HStack {
                Text("学生").font(.headline)
                Spacer()
                Button("刷新学生") { Task { await store.testConnectionAndLoadStudents() } }
                    .buttonStyle(SecondaryButtonStyle(skin: store.settings.skin))
            }
            if store.students.isEmpty {
                Text("尚未读取学生。请先连接 Windows 主机。").foregroundStyle(.secondary)
            } else {
                Picker("选择学生", selection: $store.selectedStudentID) {
                    ForEach(store.students) { student in
                        Text(student.displayName).tag(student.id)
                    }
                }
            }
        }
    }
}

struct StatusStrip: View {
    @EnvironmentObject private var store: TerminalStore

    var body: some View {
        Text(store.statusMessage)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(store.settings.skin.pale.opacity(0.8))
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    let skin: AppSkin

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .foregroundColor(.white)
            .background(skin.tint.opacity(configuration.isPressed ? 0.75 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    let skin: AppSkin

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .foregroundColor(skin.tint)
            .background(skin.pale.opacity(configuration.isPressed ? 0.65 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

@ViewBuilder
func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12, content: content)
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.88))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 2)
}
