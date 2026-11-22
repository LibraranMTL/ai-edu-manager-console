using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class LearningModeNativeHost
{
    private static int Main(string[] args)
    {
        var worker = args.Length == 2 && args[0] == "worker" && (args[1] == "host" || args[1] == "student");
        foreach (var role in new[] { "host", "student" })
        {
            if (worker && role != args[1]) continue;
            var directory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, role);
            var runtimeFile = Path.Combine(directory, "runtime.txt");
            var script = Path.Combine(directory, "learning-mode-worker.cjs");
            if (!File.Exists(runtimeFile) || !File.Exists(script)) continue;
            try
            {
                var executable = File.ReadAllText(runtimeFile).Trim();
                if (!File.Exists(executable)) continue;
                var start = new ProcessStartInfo(executable, "\"" + script + "\" " + (worker ? "worker " + role : "browser"));
                start.CreateNoWindow = true;
                start.UseShellExecute = false;
                start.RedirectStandardInput = !worker;
                start.RedirectStandardOutput = !worker;
                start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
                using (var child = Process.Start(start))
                {
                    if (worker) return 0;
                    var input = Task.Run(async () =>
                    {
                        try { await RelayInput(Console.OpenStandardInput(), child.StandardInput.BaseStream); }
                        catch (IOException) { }
                        finally { child.StandardInput.Close(); }
                    });
                    try
                    {
                        using (var output = Console.OpenStandardOutput())
                        {
                            var buffer = new byte[4096];
                            int count;
                            while ((count = child.StandardOutput.BaseStream.Read(buffer, 0, buffer.Length)) != 0)
                            {
                                output.Write(buffer, 0, count);
                                output.Flush();
                            }
                        }
                    }
                    finally
                    {
                        if (!child.HasExited) child.Kill();
                    }
                    child.WaitForExit();
                    GC.KeepAlive(input);
                    return child.ExitCode;
                }
            }
            catch (IOException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }
        return 1;
    }

    private static async Task RelayInput(Stream input, Stream destination)
    {
        var buffer = new byte[4096];
        int count;
        while ((count = await input.ReadAsync(buffer, 0, buffer.Length)) != 0)
        {
            await destination.WriteAsync(buffer, 0, count);
            await destination.FlushAsync();
        }
    }
}
