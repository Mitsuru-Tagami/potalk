using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Windows;

namespace Potalker;

public sealed class Settings
{
    public bool NotifyRooms { get; set; } = true;
    public string MicLabel { get; set; } = "";
    public bool MuteOnCreate { get; set; } = true;
    public bool MuteOnJoin { get; set; } = true;
    /// <summary>ウィンドウごとの前回の位置と大きさ（左・上・幅・高さ）</summary>
    public Dictionary<string, double[]> Windows { get; set; } = new();

    static string PathName => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Potalker", "settings.json");

    public static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(PathName)) ?? new Settings(); } catch { return new Settings(); }
    }
    public void Save()
    {
        try { Directory.CreateDirectory(Path.GetDirectoryName(PathName)); File.WriteAllText(PathName, JsonSerializer.Serialize(this)); } catch { }
    }

    /// <summary>前回の位置と大きさがあれば戻す。閉じるときに覚える。画面の外に出てしまう位置は使わない。</summary>
    public void Remember(Window w, string key)
    {
        if (Windows.TryGetValue(key, out var p) && p.Length == 4 && OnScreen(p))
        {
            w.WindowStartupLocation = WindowStartupLocation.Manual;
            w.Left = p[0]; w.Top = p[1];
            if (w.ResizeMode != ResizeMode.NoResize) { w.Width = Math.Max(p[2], w.MinWidth); w.Height = Math.Max(p[3], w.MinHeight); }
        }
        w.Closed += (_, _) =>
        {
            var b = w.WindowState == WindowState.Normal ? new Rect(w.Left, w.Top, w.Width, w.Height) : w.RestoreBounds;
            if (double.IsNaN(b.Left) || double.IsNaN(b.Width)) return;
            Windows[key] = new[] { b.Left, b.Top, b.Width, b.Height }; Save();
        };
    }

    static bool OnScreen(double[] p)
    {
        var v = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop, SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        var r = new Rect(p[0], p[1], Math.Max(p[2], 80), Math.Max(p[3], 60));
        r.Intersect(v);
        return !r.IsEmpty && r.Width > 60 && r.Height > 40;
    }
}
