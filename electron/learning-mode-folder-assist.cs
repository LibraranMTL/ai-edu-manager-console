using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class LearningModeFolderAssist
{
    private const uint Owner = 4;
    private const uint SetText = 0x000c;
    private const uint GetText = 0x000d;
    private const uint AbortIfHung = 2;
    private const int FileNameControl = 1152;
    private delegate bool VisitWindow(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(VisitWindow visit, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, VisitWindow visit, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr handle, uint command);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr handle);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder buffer, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, StringBuilder buffer, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(
        IntPtr handle, uint message, IntPtr wParam, string value, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(
        IntPtr handle, uint message, IntPtr wParam, StringBuilder value, uint flags, uint timeout, out IntPtr result);

    private static int Main(string[] args)
    {
        if (args.Length != 2 || (args[0] != "edge" && args[0] != "chrome") ||
            !Regex.IsMatch(args[1], @"\A[0-9a-f]{16}\z")) return 2;
        var folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "browser-extension");
        if (!File.Exists(Path.Combine(folder, "manifest.json"))) return 2;
        var browserName = args[0] == "edge" ? "msedge" : "chrome";
        var watch = Stopwatch.StartNew();
        IntPtr browserWindow = IntPtr.Zero;
        uint browserProcess = 0;
        while (watch.ElapsedMilliseconds < 120000)
        {
            if (browserWindow == IntPtr.Zero)
            {
                var guide = FindWindow(handle => MatchesGuide(handle, browserName, args[1]));
                if (guide != IntPtr.Zero)
                {
                    browserWindow = guide;
                    GetWindowThreadProcessId(browserWindow, out browserProcess);
                }
            }
            else
            {
                uint currentProcess;
                GetWindowThreadProcessId(browserWindow, out currentProcess);
                if (!IsWindow(browserWindow) || currentProcess != browserProcess) return 1;
                var dialog = FindWindow(handle => IsExtensionPicker(handle, browserWindow));
                if (dialog != IntPtr.Zero)
                {
                    var editor = FindChild(dialog, handle => GetDlgCtrlID(handle) == FileNameControl);
                    if (editor != IntPtr.Zero && WindowString(editor, true) != "Edit")
                        editor = FindChild(editor, handle => WindowString(handle, true) == "Edit");
                    if (editor != IntPtr.Zero && FillEmptyEditor(editor, folder)) return 0;
                }
            }
            Thread.Sleep(150);
        }
        return 1;
    }

    private static bool MatchesGuide(IntPtr handle, string browserName, string marker)
    {
        if (WindowString(handle, true) != "Chrome_WidgetWin_1" ||
            WindowString(handle, false).IndexOf(" · " + marker, StringComparison.Ordinal) < 0) return false;
        uint processId;
        GetWindowThreadProcessId(handle, out processId);
        try
        {
            using (var process = Process.GetProcessById((int)processId))
                return String.Equals(process.ProcessName, browserName, StringComparison.OrdinalIgnoreCase);
        }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    private static bool IsExtensionPicker(IntPtr dialog, IntPtr browserWindow)
    {
        if (dialog == IntPtr.Zero || WindowString(dialog, true) != "#32770") return false;
        var title = WindowString(dialog, false);
        var english = title.IndexOf("extension", StringComparison.OrdinalIgnoreCase) >= 0 &&
            (title.IndexOf("directory", StringComparison.OrdinalIgnoreCase) >= 0 || title.IndexOf("folder", StringComparison.OrdinalIgnoreCase) >= 0);
        var chinese = title.Contains("扩展") && (title.Contains("目录") || title.Contains("文件夹") || title.Contains("位置"));
        if (!english && !chinese) return false;
        for (var owner = GetWindow(dialog, Owner); owner != IntPtr.Zero; owner = GetWindow(owner, Owner))
            if (owner == browserWindow) return true;
        return false;
    }

    private static string WindowString(IntPtr handle, bool windowClass)
    {
        var buffer = new StringBuilder(320);
        if (windowClass) GetClassName(handle, buffer, buffer.Capacity);
        else GetWindowText(handle, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private static IntPtr FindChild(IntPtr parent, Predicate<IntPtr> match)
    {
        var result = IntPtr.Zero;
        EnumChildWindows(parent, (handle, parameter) =>
        {
            if (!IsWindowVisible(handle) || !match(handle)) return true;
            result = handle;
            return false;
        }, IntPtr.Zero);
        return result;
    }

    private static IntPtr FindWindow(Predicate<IntPtr> match)
    {
        var result = IntPtr.Zero;
        EnumWindows((handle, parameter) =>
        {
            if (!IsWindowVisible(handle) || !match(handle)) return true;
            result = handle;
            return false;
        }, IntPtr.Zero);
        return result;
    }

    private static bool FillEmptyEditor(IntPtr editor, string folder)
    {
        var current = new StringBuilder(32768);
        IntPtr result;
        if (SendMessageTimeout(editor, GetText, new IntPtr(current.Capacity), current, AbortIfHung, 300, out result) == IntPtr.Zero)
            return false;
        if (String.Equals(current.ToString(), folder, StringComparison.OrdinalIgnoreCase)) return true;
        if (current.Length != 0) return false;
        return SendMessageTimeout(editor, SetText, IntPtr.Zero, folder, AbortIfHung, 300, out result) != IntPtr.Zero && result != IntPtr.Zero;
    }
}
