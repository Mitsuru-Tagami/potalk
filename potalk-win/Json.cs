using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Potalker;

/// <summary>ページから届く JSON を気軽に読むための小さな道具。無いキーは null（Has() が false）。</summary>
public static class J
{
    static readonly JsonElement Nul = JsonDocument.Parse("null").RootElement;
    public static readonly JsonElement Empty = JsonDocument.Parse("{}").RootElement;

    public static JsonElement P(this JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) ? v : Nul;
    public static string S(this JsonElement e, string k)
    {
        var v = e.P(k);
        return v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : "";
    }
    public static bool B(this JsonElement e, string k) => e.P(k).ValueKind == JsonValueKind.True;
    public static IEnumerable<JsonElement> A(this JsonElement e, string k)
    {
        var v = e.P(k);
        return v.ValueKind == JsonValueKind.Array ? v.EnumerateArray() : Enumerable.Empty<JsonElement>();
    }
    public static bool Has(this JsonElement e) => e.ValueKind == JsonValueKind.Object;
}
