using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.CompilerServices;
using System.Text;

const string defaultOutputPath = "../DeskCue.Tray/Assets/deskcue.ico";
int[] iconSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
var outputPath = Path.GetFullPath(args.FirstOrDefault() ?? defaultOutputPath, GetSourceDirectory());
var iconImages = iconSizes.Select(RenderIcon).ToArray();

Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

using (var output = File.Create(outputPath))
using (var writer = new BinaryWriter(output, Encoding.UTF8, leaveOpen: false))
{
    WriteIcon(writer, iconSizes, iconImages);
}

Console.WriteLine(outputPath);

static string GetSourceDirectory([CallerFilePath] string sourceFilePath = "")
{
    return Path.GetDirectoryName(sourceFilePath)
        ?? throw new InvalidOperationException("Could not resolve the icon generator source directory.");
}

static byte[] RenderIcon(int size)
{
    const int sourceSize = 512;
    const int supersampling = 4;
    var renderSize = size * supersampling;
    var scale = (float)renderSize / sourceSize;

    using var source = new Bitmap(renderSize, renderSize, PixelFormat.Format32bppArgb);
    using var graphics = Graphics.FromImage(source);
    using var background = new SolidBrush(Color.FromArgb(17, 18, 20));
    using var foreground = new SolidBrush(Color.FromArgb(244, 239, 230));
    using var accent = new SolidBrush(Color.FromArgb(214, 164, 103));
    using var backgroundPath = CreateRoundedRectangle(
        new RectangleF(0, 0, sourceSize, sourceSize),
        radius: 112
    );
    using var letterPath = CreateLetterPath();

    graphics.Clear(Color.Transparent);
    graphics.SmoothingMode = SmoothingMode.AntiAlias;
    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
    graphics.ScaleTransform(scale, scale);
    graphics.FillPath(background, backgroundPath);
    graphics.FillPath(foreground, letterPath);
    graphics.FillEllipse(accent, 362, 116, 52, 52);

    using var final = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    using var finalGraphics = Graphics.FromImage(final);

    finalGraphics.Clear(Color.Transparent);
    finalGraphics.CompositingQuality = CompositingQuality.HighQuality;
    finalGraphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
    finalGraphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
    finalGraphics.DrawImage(source, new Rectangle(0, 0, size, size));

    using var stream = new MemoryStream();

    final.Save(stream, ImageFormat.Png);
    return stream.ToArray();
}

static GraphicsPath CreateRoundedRectangle(RectangleF bounds, float radius)
{
    var diameter = radius * 2;
    var path = new GraphicsPath();

    path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
    path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
    path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
    path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
    path.CloseFigure();

    return path;
}

static GraphicsPath CreateLetterPath()
{
    var path = new GraphicsPath(FillMode.Alternate);

    path.StartFigure();
    path.AddLine(154, 142, 282, 142);
    path.AddBezier(282, 142, 364, 142, 412, 185, 412, 256);
    path.AddBezier(412, 256, 412, 327, 364, 370, 282, 370);
    path.AddLine(282, 370, 154, 370);
    path.CloseFigure();

    path.StartFigure();
    path.AddLine(270, 322, 212, 322);
    path.AddLine(212, 322, 212, 190);
    path.AddLine(212, 190, 270, 190);
    path.AddBezier(270, 190, 326, 190, 358, 214, 358, 256);
    path.AddBezier(358, 256, 358, 298, 326, 322, 270, 322);
    path.CloseFigure();

    return path;
}

static void WriteIcon(BinaryWriter writer, IReadOnlyList<int> sizes, IReadOnlyList<byte[]> images)
{
    const int iconDirectorySize = 6;
    const int iconDirectoryEntrySize = 16;
    var imageOffset = iconDirectorySize + (iconDirectoryEntrySize * images.Count);

    writer.Write((ushort)0);
    writer.Write((ushort)1);
    writer.Write((ushort)images.Count);

    for (var index = 0; index < images.Count; index += 1)
    {
        var size = sizes[index];
        var image = images[index];

        writer.Write((byte)(size == 256 ? 0 : size));
        writer.Write((byte)(size == 256 ? 0 : size));
        writer.Write((byte)0);
        writer.Write((byte)0);
        writer.Write((ushort)1);
        writer.Write((ushort)32);
        writer.Write((uint)image.Length);
        writer.Write((uint)imageOffset);

        imageOffset += image.Length;
    }

    foreach (var image in images) writer.Write(image);
}
