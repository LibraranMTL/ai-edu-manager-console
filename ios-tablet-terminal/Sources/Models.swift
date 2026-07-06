import Foundation
import SwiftUI
import UIKit

let appVersionName = "0.4.4"
let appVersionCode = 1
let updateManifestURL = URL(string: "https://www.greatbg.com/download/edu-manager-version.json")!
let userAgreementURL = URL(string: "https://www.greatbg.com/download/agreement.html")!
let privacyPolicyURL = URL(string: "https://www.greatbg.com/download/privacy.html")!
let tailscaleDownloadURL = URL(string: "https://apps.apple.com/us/app/tailscale/id1470499037")!
let tailscaleInstallGuideURL = URL(string: "https://tailscale.com/docs/install/ios")!

enum AppSection: String, CaseIterable, Identifiable {
    case home
    case upload
    case archive
    case contact
    case status
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "首页"
        case .upload: return "上传资料到主机"
        case .archive: return "查看学情档案"
        case .contact: return "联系教育管家"
        case .status: return "连接状态"
        case .settings: return "系统设置"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house"
        case .upload: return "square.and.arrow.up"
        case .archive: return "book"
        case .contact: return "message"
        case .status: return "network"
        case .settings: return "gearshape"
        }
    }
}

enum LayoutMode: String, CaseIterable, Identifiable, Codable {
    case adaptive
    case tabletLandscape
    case phonePortrait

    var id: String { rawValue }

    var title: String {
        switch self {
        case .adaptive: return "自适应"
        case .tabletLandscape: return "平板横屏"
        case .phonePortrait: return "手机竖屏"
        }
    }
}

enum AppSkin: String, CaseIterable, Identifiable, Codable {
    case blue
    case pink
    case green
    case purple
    case orange

    var id: String { rawValue }

    var title: String {
        switch self {
        case .blue: return "蓝色系"
        case .pink: return "粉色系"
        case .green: return "绿色系"
        case .purple: return "紫色系"
        case .orange: return "橙色系"
        }
    }

    var imageName: String {
        switch self {
        case .blue: return "SkinBlue"
        case .pink: return "SkinPink"
        case .green: return "SkinGreen"
        case .purple: return "SkinPurple"
        case .orange: return "SkinOrange"
        }
    }

    var tint: Color {
        switch self {
        case .blue: return Color(red: 0.06, green: 0.43, blue: 0.77)
        case .pink: return Color(red: 0.84, green: 0.20, blue: 0.52)
        case .green: return Color(red: 0.18, green: 0.59, blue: 0.36)
        case .purple: return Color(red: 0.49, green: 0.30, blue: 0.69)
        case .orange: return Color(red: 0.86, green: 0.45, blue: 0.17)
        }
    }

    var pale: Color {
        switch self {
        case .blue: return Color(red: 0.91, green: 0.96, blue: 1.0)
        case .pink: return Color(red: 1.0, green: 0.91, blue: 0.96)
        case .green: return Color(red: 0.91, green: 0.97, blue: 0.93)
        case .purple: return Color(red: 0.95, green: 0.91, blue: 1.0)
        case .orange: return Color(red: 1.0, green: 0.94, blue: 0.88)
        }
    }
}

enum ConnectionMode: String, CaseIterable, Identifiable, Codable {
    case lanOnly
    case lanAndTailscale
    case manualRemote

    var id: String { rawValue }

    var title: String {
        switch self {
        case .lanOnly: return "仅局域网"
        case .lanAndTailscale: return "局域网 + Tailscale"
        case .manualRemote: return "手动输入远程主机地址"
        }
    }
}

enum ArchiveCategory: String, CaseIterable, Identifiable {
    case summary
    case report
    case qa
    case other
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .summary: return "资料摘要"
        case .report: return "综合汇总"
        case .qa: return "问答精华"
        case .other: return "其他"
        case .all: return "所有文档"
        }
    }
}

struct TerminalSettings: Codable {
    var serverURL: String = ""
    var remoteURL: String = ""
    var apiToken: String = ""
    var deviceID: String = "ios-\(UUID().uuidString)"
    var deviceName: String = UIDevice.current.name
    var connectionMode: ConnectionMode = .lanAndTailscale
    var layoutMode: LayoutMode = .adaptive
    var skin: AppSkin = .blue
    var lastConnectedAt: String = ""
}

struct Student: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var grade: String?
    var school: String?
    var goal: String?
    var remoteChannel: String?
    var remoteContact: String?
    var remoteNote: String?
    var remoteBindingStatus: String?
    var pendingDigestCount: Int?
    var submittedDigestCount: Int?
    var processedDigestCount: Int?

    var displayName: String {
        let gradeText = (grade ?? "").isEmpty ? "" : " · \(grade!)"
        return "\(name)\(gradeText)"
    }
}

struct ArchiveFile: Identifiable, Codable, Hashable {
    var id: String { path }
    var name: String
    var path: String
    var modified: Double?
}

struct PairPayload: Codable {
    var type: String?
    var serverUrl: String?
    var pairCode: String?
    var tailscaleUrl: String?
    var tailscaleUrls: [String]?
}

struct UpdateManifest: Codable {
    var iosVersionCode: Int?
    var iosVersionName: String?
    var iosUrl: String?
    var tabletTerminalVersionCode: Int?
    var tabletTerminalVersionName: String?
    var tabletTerminalApkUrl: String?
    var notes: String?
}

struct HostStudentsResponse: Codable {
    var ok: Bool
    var students: [Student]
    var message: String?
}

struct ArchiveFilesResponse: Codable {
    var ok: Bool
    var folder: String?
    var files: [ArchiveFile]
    var message: String?
}

struct ArchiveFileResponse: Codable {
    var ok: Bool
    var path: String?
    var content: String?
    var message: String?
}

struct PairConfirmResponse: Codable {
    var ok: Bool
    var token: String?
    var students: [Student]?
    var message: String?
}

struct GenericResponse: Codable {
    var ok: Bool
    var message: String?
}
