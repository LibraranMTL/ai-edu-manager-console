using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

// A small, synchronous Windows hook runner. It must not depend on a separately installed Node runtime.
internal static class AgentLifecycleHook
{
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    private static int Main(string[] args)
    {
        string sourceAgent = Argument(args, "-SourceAgent");
        try
        {
            Capture(Argument(args, "-Descriptor"), sourceAgent);
        }
        catch
        {
            // Capture must never interrupt an Agent conversation.
        }
        finally
        {
            // Codex Stop requires JSON on stdout. An empty object is harmless for its other events.
            if (String.Equals(sourceAgent, "codex", StringComparison.OrdinalIgnoreCase))
                Console.WriteLine("{}");
        }
        return 0;
    }

    private static string Argument(string[] args, string name)
    {
        for (int i = 0; i + 1 < args.Length; i++)
            if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        return "";
    }

    private static IDictionary<string, object> ObjectValue(object value)
    {
        return value as IDictionary<string, object>;
    }

    private static object Field(IDictionary<string, object> value, string name)
    {
        object result;
        return value != null && value.TryGetValue(name, out result) ? result : null;
    }

    private static string Text(object value)
    {
        return value == null ? "" : Convert.ToString(value, CultureInfo.InvariantCulture);
    }

    private static void Capture(string descriptorPath, string sourceAgent)
    {
        if (String.IsNullOrWhiteSpace(descriptorPath) || !File.Exists(descriptorPath)) return;
        var descriptor = ObjectValue(new JsonParser(File.ReadAllText(descriptorPath, Utf8)).Parse());
        var capture = ObjectValue(Field(descriptor, "lifecycleCapture"));
        if (!Object.Equals(Field(capture, "enabled"), true)) return;
        string captureEpoch = Text(Field(capture, "captureEpoch"));
        if (String.IsNullOrWhiteSpace(captureEpoch)) return;
        bool allowed = false;
        var allowedAgents = Field(capture, "allowedAgents") as List<object>;
        if (allowedAgents != null)
            foreach (var agent in allowedAgents)
                if (String.Equals(Text(agent), sourceAgent, StringComparison.Ordinal)) allowed = true;
        if (!allowed) return;

        string queueDir = Text(Field(capture, "queueDir"));
        if (String.IsNullOrWhiteSpace(queueDir)) return;
        Console.InputEncoding = Utf8;
        string raw = Console.In.ReadToEnd().Trim();
        if (raw.Length < 2 || raw[0] != '{' || raw[raw.Length - 1] != '}') return;
        if (ObjectValue(new JsonParser(raw).Parse()) == null) return;

        var defaults = ObjectValue(Field(descriptor, "defaults"));
        var authentication = ObjectValue(Field(descriptor, "authentication"));
        DateTime now = DateTime.UtcNow;
        string envelope = "{\"schema\":\"edu-manager.agent-lifecycle-event.v1\",\"sourceAgent\":" + JsonString(sourceAgent)
            + ",\"scopeId\":" + JsonString(Text(Field(defaults, "scopeId")))
            + ",\"grantId\":" + JsonString(Text(Field(authentication, "grantId")))
            + ",\"captureEpoch\":" + JsonString(captureEpoch)
            + ",\"capturedAt\":" + JsonString(now.ToString("o", CultureInfo.InvariantCulture))
            + ",\"payload\":" + raw + "}";
        Directory.CreateDirectory(queueDir);
        string target = Path.Combine(queueDir, now.ToString("yyyyMMddHHmmssfffffff", CultureInfo.InvariantCulture)
            + "-" + Guid.NewGuid().ToString("N") + ".json");
        string temporary = target + ".tmp";
        File.WriteAllText(temporary, envelope, Utf8);
        File.Move(temporary, target);
    }

    private static string JsonString(string value)
    {
        var output = new StringBuilder("\"");
        foreach (char character in value ?? "")
        {
            switch (character)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break;
                case '\f': output.Append("\\f"); break;
                case '\n': output.Append("\\n"); break;
                case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if (character < 0x20) output.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    else output.Append(character);
                    break;
            }
        }
        return output.Append('"').ToString();
    }

    private sealed class JsonParser
    {
        private readonly string source;
        private int position;

        internal JsonParser(string source) { this.source = source; }

        internal object Parse()
        {
            object value = ReadValue(0);
            WhiteSpace();
            if (position != source.Length) throw new FormatException("Trailing JSON content.");
            return value;
        }

        private void WhiteSpace()
        {
            while (position < source.Length && (source[position] == ' ' || source[position] == '\r'
                || source[position] == '\n' || source[position] == '\t')) position++;
        }

        private char Next()
        {
            if (position >= source.Length) throw new FormatException("Unexpected end of JSON.");
            return source[position++];
        }

        private void Expect(char expected)
        {
            if (Next() != expected) throw new FormatException("Invalid JSON delimiter.");
        }

        private object ReadValue(int depth)
        {
            if (depth > 64) throw new FormatException("JSON is too deeply nested.");
            WhiteSpace();
            if (position >= source.Length) throw new FormatException("Missing JSON value.");
            char current = source[position];
            if (current == '{') return ReadObject(depth + 1);
            if (current == '[') return ReadArray(depth + 1);
            if (current == '"') return ReadString();
            if (current == 't' && Literal("true")) return true;
            if (current == 'f' && Literal("false")) return false;
            if (current == 'n' && Literal("null")) return null;
            if (current == '-' || (current >= '0' && current <= '9')) return ReadNumber();
            throw new FormatException("Invalid JSON value.");
        }

        private bool Literal(string value)
        {
            if (position + value.Length > source.Length || String.CompareOrdinal(source, position, value, 0, value.Length) != 0) return false;
            position += value.Length;
            return true;
        }

        private IDictionary<string, object> ReadObject(int depth)
        {
            Expect('{');
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            WhiteSpace();
            if (position < source.Length && source[position] == '}') { position++; return result; }
            while (true)
            {
                WhiteSpace();
                string key = ReadString();
                WhiteSpace();
                Expect(':');
                result[key] = ReadValue(depth);
                WhiteSpace();
                char delimiter = Next();
                if (delimiter == '}') return result;
                if (delimiter != ',') throw new FormatException("Invalid JSON object.");
            }
        }

        private List<object> ReadArray(int depth)
        {
            Expect('[');
            var result = new List<object>();
            WhiteSpace();
            if (position < source.Length && source[position] == ']') { position++; return result; }
            while (true)
            {
                result.Add(ReadValue(depth));
                WhiteSpace();
                char delimiter = Next();
                if (delimiter == ']') return result;
                if (delimiter != ',') throw new FormatException("Invalid JSON array.");
            }
        }

        private string ReadString()
        {
            Expect('"');
            var result = new StringBuilder();
            while (true)
            {
                char current = Next();
                if (current == '"') return result.ToString();
                if (current < 0x20) throw new FormatException("Invalid JSON string.");
                if (current != '\\') { result.Append(current); continue; }
                char escaped = Next();
                switch (escaped)
                {
                    case '"': result.Append('"'); break;
                    case '\\': result.Append('\\'); break;
                    case '/': result.Append('/'); break;
                    case 'b': result.Append('\b'); break;
                    case 'f': result.Append('\f'); break;
                    case 'n': result.Append('\n'); break;
                    case 'r': result.Append('\r'); break;
                    case 't': result.Append('\t'); break;
                    case 'u':
                        if (position + 4 > source.Length) throw new FormatException("Invalid Unicode escape.");
                        result.Append((char)Int32.Parse(source.Substring(position, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        position += 4;
                        break;
                    default: throw new FormatException("Invalid JSON escape.");
                }
            }
        }

        private string ReadNumber()
        {
            int start = position;
            if (source[position] == '-') position++;
            if (position >= source.Length) throw new FormatException("Invalid JSON number.");
            if (source[position] == '0') position++;
            else
            {
                if (source[position] < '1' || source[position] > '9') throw new FormatException("Invalid JSON number.");
                while (position < source.Length && source[position] >= '0' && source[position] <= '9') position++;
            }
            if (position < source.Length && source[position] == '.')
            {
                position++;
                int digits = position;
                while (position < source.Length && source[position] >= '0' && source[position] <= '9') position++;
                if (digits == position) throw new FormatException("Invalid JSON number.");
            }
            if (position < source.Length && (source[position] == 'e' || source[position] == 'E'))
            {
                position++;
                if (position < source.Length && (source[position] == '+' || source[position] == '-')) position++;
                int digits = position;
                while (position < source.Length && source[position] >= '0' && source[position] <= '9') position++;
                if (digits == position) throw new FormatException("Invalid JSON number.");
            }
            return source.Substring(start, position - start);
        }
    }
}
