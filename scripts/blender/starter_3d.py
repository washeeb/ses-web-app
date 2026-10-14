# Starter 3D renders (generic devices, no text, people or real brands) for home page slides and shop categories.
# Shared by the KingsView and Synclytics apps; each brand has its own palette and scenes.
#
# Run inside Blender 5.x, one scene per call (renders take about a minute each):
#   blender --background --python scripts/blender/starter_3d.py -- <brand> <scene> <light|dark> <out.png>
# or from the Blender MCP / Python console with runpy.run_path(..., init_globals={"ARGS": [...]}).
# Then `npm run images:build` converts the PNGs in assets/renders to the web copies and the manifest.
import math
import sys

import bmesh
import bpy
from mathutils import Vector

PALETTES = {
    "kvs": {
        "body": "#1c1c1c", "body2": "#2b2b2b", "trim": "#3a3a3a", "accent": "#b00101", "accent2": "#d11a1a",
        "led": "#ff3b3b", "screen": "#ffffff", "soft": "#f3e1e1", "paper": "#ffffff", "metal": "#9a9a9a",
        "light_bg": "#f5f3f1", "dark_bg": "#141414", "rim": "#d11a1a", "fill": "#ffe9e0",
    },
    "ses": {
        "body": "#1b2638", "body2": "#24324a", "trim": "#37496a", "accent": "#00a6a6", "accent2": "#19c3c3",
        "led": "#19c3c3", "screen": "#ffffff", "soft": "#dcebf5", "paper": "#ffffff", "metal": "#9aa6b8",
        "light_bg": "#f3f6fb", "dark_bg": "#001a40", "rim": "#19c3c3", "fill": "#bfe0e6", "navy": "#0b3a82",
    },
}


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


class Kit:
    def __init__(self, brand, theme):
        self.p = PALETTES[brand]
        self.theme = theme
        self.brand = brand
        name = "Starter 3D"
        old = bpy.data.scenes.get(name)
        if old:
            for o in list(old.collection.all_objects):
                bpy.data.objects.remove(o, do_unlink=True)
            self.sc = old
        else:
            self.sc = bpy.data.scenes.new(name)
        self._mats = {}

    # ---------- materials ----------
    def mat(self, key, color, rough=0.4, metal=0.0, emit=None, strength=0.0):
        k = f"{self.brand}-{key}"
        m = bpy.data.materials.get(k) or bpy.data.materials.new(k)
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (*lin(color), 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        b.inputs["Emission Color"].default_value = (*lin(emit or "#000000"), 1)
        b.inputs["Emission Strength"].default_value = strength
        return m

    def m(self, key):
        p = self.p
        table = {
            "body": (p["body"], 0.38), "body2": (p["body2"], 0.3), "trim": (p["trim"], 0.35),
            "accent": (p["accent"], 0.35), "accent2": (p["accent2"], 0.35), "paper": (p["paper"], 0.7),
            "soft": (p["soft"], 0.6), "metal": (p["metal"], 0.3), "glass": ("#0b1320", 0.08), "white": ("#f7f7f7", 0.45),
            "navy": (p.get("navy", p["body2"]), 0.35), "gold": ("#d9b45a", 0.3), "wall": ("#e9e7e4" if self.brand == "kvs" else "#e6ecf4", 0.8),
        }
        if key in table:
            c, r = table[key]
            return self.mat(key, c, r, 0.6 if key == "metal" else 0.0)
        if key == "led":
            return self.mat("led", "#000000", 0.3, emit=p["led"], strength=8)
        if key == "screen":
            return self.mat("screen", "#000000", 0.2, emit=p["screen"], strength=1.6)
        raise KeyError(key)

    # ---------- primitives ----------
    def _link(self, name, me, mat, loc, rot):
        o = bpy.data.objects.new(name, me)
        self.sc.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = rot
        if mat:
            o.data.materials.append(self.m(mat) if isinstance(mat, str) else mat)
        return o

    def box(self, size, loc, mat, rot=(0, 0, 0), bevel=0.03, name="box"):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        bm.to_mesh(me)
        bm.free()
        for f in me.polygons:
            f.use_smooth = True
        o = self._link(name, me, mat, loc, rot)
        if bevel:
            bv = o.modifiers.new("Bevel", "BEVEL")
            bv.width = min(bevel, min(size) * 0.45)
            bv.segments = 5
            o.modifiers.new("Normals", "WEIGHTED_NORMAL")
        return o

    def cyl(self, r, depth, loc, mat, rot=(0, 0, 0), r2=None, verts=48, name="cyl", bevel=0.0):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
        bm.to_mesh(me)
        bm.free()
        for f in me.polygons:
            f.use_smooth = True
        o = self._link(name, me, mat, loc, rot)
        if bevel:
            bv = o.modifiers.new("Bevel", "BEVEL")
            bv.width = bevel
            bv.segments = 4
            bv.limit_method = "ANGLE"
        return o

    def sphere(self, r, loc, mat, scale=(1, 1, 1), name="sphere"):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r)
        bm.to_mesh(me)
        bm.free()
        for f in me.polygons:
            f.use_smooth = True
        o = self._link(name, me, mat, loc, (0, 0, 0))
        o.scale = scale
        return o

    def torus(self, major, minor, loc, mat, rot=(0, 0, 0), name="torus"):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        segs, rings = 48, 16
        verts = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring = []
            for j in range(rings):
                b = 2 * math.pi * j / rings
                x = (major + minor * math.cos(b)) * math.cos(a)
                y = (major + minor * math.cos(b)) * math.sin(a)
                z = minor * math.sin(b)
                ring.append(bm.verts.new((x, y, z)))
            verts.append(ring)
        for i in range(segs):
            for j in range(rings):
                bm.faces.new((verts[i][j], verts[(i + 1) % segs][j], verts[(i + 1) % segs][(j + 1) % rings], verts[i][(j + 1) % rings]))
        bm.to_mesh(me)
        bm.free()
        for f in me.polygons:
            f.use_smooth = True
        return self._link(name, me, mat, loc, rot)

    def extrude_outline(self, pts, depth, loc, mat, rot=(math.pi / 2, 0, 0), bevel=0.04, name="shape"):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, 0)) for x, y in pts]
        f = bm.faces.new(vs)
        r = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, vec=(0, 0, depth), verts=[v for v in r["geom"] if isinstance(v, bmesh.types.BMVert)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        o = self._link(name, me, mat, loc, rot)
        if bevel:
            bv = o.modifiers.new("Bevel", "BEVEL")
            bv.width = bevel
            bv.segments = 4
            bv.limit_method = "ANGLE"
        return o

    def tube(self, points, radius, mat, name="cable"):
        cu = bpy.data.curves.new(name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = radius
        cu.bevel_resolution = 6
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(points) - 1)
        for bp, co in zip(sp.bezier_points, points):
            bp.co = co
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        o = bpy.data.objects.new(name, cu)
        self.sc.collection.objects.link(o)
        cu.materials.append(self.m(mat))
        return o

    def group(self, objs, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
        """Parents objects to an empty so a device can be placed as one piece."""
        e = bpy.data.objects.new("group", None)
        self.sc.collection.objects.link(e)
        for o in objs:
            o.parent = e
        e.location = loc
        e.rotation_euler = (0, 0, rot_z)
        e.scale = (scale, scale, scale)
        return e

    # ---------- devices (built around the origin, resting on z=0) ----------
    def router(self):
        o = [self.box((2.4, 1.5, 0.32), (0, 0, 0.16), "body", bevel=0.07), self.box((2.2, 1.3, 0.04), (0, 0, 0.33), "body2", bevel=0.02)]
        o += [self.box((0.08, 0.02, 0.045), (-0.7 + i * 0.25, -0.755, 0.18), "led", bevel=0.008) for i in range(5)]
        for x, t in ((-0.9, -0.18), (0, 0), (0.9, 0.18)):
            o.append(self.cyl(0.055, 1.6, (x + math.sin(t) * 0.8, 0.62, 1.12), "body", rot=(0, t, 0)))
            o.append(self.cyl(0.08, 0.14, (x, 0.62, 0.36), "body", rot=(0, math.pi / 2, 0)))
        return o

    def switch(self, ports=12):
        w = 0.4 + ports * 0.22
        o = [self.box((w, 1.1, 0.26), (0, 0, 0.13), "body", bevel=0.04)]
        for i in range(ports):
            x = -w / 2 + 0.3 + i * 0.22
            o.append(self.box((0.16, 0.03, 0.12), (x, -0.55, 0.14), "glass", bevel=0.01))
            o.append(self.box((0.03, 0.02, 0.02), (x + 0.05, -0.555, 0.06), "led", bevel=0))
        return o

    def screen_content(self, w, h, origin, normal_rot, style="dash"):
        """Simple UI shapes on a screen (no text): a header bar and coloured blocks or bars."""
        ox, oy, oz = origin
        o = []
        rx = normal_rot

        def plate(px, pz, sw, sh, mat, lift=0.004):
            # px/pz are in screen space: x across, z up the screen. Flat, self-lit colours so the UI reads crisply.
            loc = Vector((px, -lift, pz))
            loc.rotate(rx)
            colour = {"body": self.p["body"], "body2": self.p["body2"], "trim": "#b9b9b9" if self.brand == "kvs" else "#b9c6d6", "accent": self.p["accent"], "soft": self.p["soft"]}[mat]
            ui = self.mat("ui-" + mat, colour, 0.9, emit=colour, strength=0.9)
            o.append(self.box((sw, 0.006, sh), (ox + loc.x, oy + loc.y, oz + loc.z), ui, rot=rx.to_euler(), bevel=0))
        plate(0, h * 0.40, w * 0.92, h * 0.1, "body2")
        if style == "dash":
            vals = [0.35, 0.6, 0.45, 0.85, 0.55, 0.7]
            bw = w * 0.1
            for i, v in enumerate(vals):
                bh = h * 0.55 * v
                plate(-w * 0.36 + i * w * 0.145, -h * 0.4 + bh / 2, bw, bh, "accent" if i == 3 else ("body2" if i % 2 else "trim"))
        elif style == "app":
            plate(-w * 0.2, h * 0.17, w * 0.45, h * 0.08, "accent")
            for i in range(3):
                plate(-w * 0.3 + i * w * 0.3, -h * 0.18, w * 0.26, h * 0.32, "soft")
                plate(-w * 0.38 + i * w * 0.3, -h * 0.07, w * 0.06, h * 0.08, "accent" if i == 1 else "body")
        elif style == "alert":
            plate(0, -h * 0.05, h * 0.42, h * 0.42, "accent")
        elif style == "code":
            for i, (x, ww, mat) in enumerate([(0, 0.3, "accent"), (0.05, 0.45, "trim"), (0.05, 0.25, "accent"), (0.1, 0.4, "trim"), (0.1, 0.3, "accent"), (0.05, 0.5, "trim")]):
                plate(-w * 0.42 + w * x + w * ww / 2, h * 0.25 - i * h * 0.12, w * ww, h * 0.05, mat)
        return o

    def laptop(self, style="dash", open_deg=105):
        w, d = 3.2, 2.2
        o = [self.box((w, d, 0.12), (0, 0, 0.06), "metal", bevel=0.05), self.box((w * 0.9, d * 0.55, 0.01), (0, 0.15, 0.125), "body2", bevel=0)]
        o.append(self.box((w * 0.3, d * 0.22, 0.008), (0, -0.7, 0.122), "trim", bevel=0.01))
        a = math.radians(open_deg - 90)
        from mathutils import Matrix
        rot = Matrix.Rotation(-a, 3, "X")
        hinge = Vector((0, d / 2 - 0.05, 0.12))
        lid_h = 2.0
        c = hinge + rot @ Vector((0, 0.03, lid_h / 2))
        o.append(self.box((w, 0.08, lid_h), c, "metal", rot=rot.to_euler(), bevel=0.04))
        sc_center = hinge + rot @ Vector((0, -0.015, lid_h / 2 + 0.03))
        o.append(self.box((w * 0.9, 0.01, lid_h * 0.86), sc_center, "screen", rot=rot.to_euler(), bevel=0))
        o += self.screen_content(w * 0.9, lid_h * 0.86, tuple(sc_center), rot, style)
        return o

    def monitor(self, style="dash", w=3.2, h=1.9):
        from mathutils import Matrix
        rot = Matrix.Rotation(math.radians(-6), 3, "X")
        center = Vector((0, 0, 0.5 + h / 2 + 0.2))
        o = [self.box((w, 0.12, h), center, "body", rot=rot.to_euler(), bevel=0.04)]
        sc = center + rot @ Vector((0, -0.065, 0))
        o.append(self.box((w * 0.94, 0.01, h * 0.9), sc, "screen", rot=rot.to_euler(), bevel=0))
        o += self.screen_content(w * 0.94, h * 0.9, tuple(sc), rot, style)
        o.append(self.box((0.22, 0.14, 0.8), (0, 0.15, 0.45), "trim", bevel=0.03))
        o.append(self.box((1.2, 0.8, 0.07), (0, 0.1, 0.035), "trim", bevel=0.03))
        return o

    def phone(self, style="app"):
        from mathutils import Matrix
        rot = Matrix.Rotation(math.radians(-12), 3, "X")
        c = Vector((0, 0, 1.05))
        o = [self.box((1.0, 0.1, 2.0), c, "body", rot=rot.to_euler(), bevel=0.05)]
        sc = c + rot @ Vector((0, -0.052, 0))
        o.append(self.box((0.9, 0.01, 1.86), sc, "screen", rot=rot.to_euler(), bevel=0))
        o += self.screen_content(0.9, 1.86, tuple(sc), rot, style)
        o.append(self.box((0.6, 0.6, 0.06), (0, 0.25, 0.03), "trim", bevel=0.02))  # stand
        return o

    def keyboard(self):
        o = [self.box((3.4, 1.1, 0.1), (0, 0, 0.05), "body", bevel=0.04)]
        for r in range(4):
            for c in range(13):
                o.append(self.box((0.2, 0.18, 0.06), (-1.5 + c * 0.25, -0.38 + r * 0.25, 0.12), "body2", bevel=0.02))
        return o

    def mouse(self):
        return [self.sphere(0.36, (0, 0, 0.18), "body", scale=(0.75, 1.15, 0.5)), self.box((0.04, 0.16, 0.04), (0, 0.18, 0.36), "accent", bevel=0.015)]

    def server_rack(self, units=7):
        h = 0.3 + units * 0.36
        o = [self.box((1.5, 1.4, h), (0, 0, h / 2), "body", bevel=0.05)]
        for i in range(units):
            z = 0.25 + i * 0.36
            o.append(self.box((1.32, 0.04, 0.28), (0, -0.7, z), "body2", bevel=0.015))
            o.append(self.box((0.05, 0.02, 0.05), (-0.5, -0.725, z), "led", bevel=0))
            o.append(self.box((0.6, 0.02, 0.06), (0.2, -0.725, z), "trim", bevel=0))
        return o

    def bullet_camera(self):
        o = [self.box((1.5, 0.16, 2.3), (0, 1.08, 1.15), "wall", bevel=0.03)]  # wall
        o.append(self.box((0.5, 0.2, 0.9), (0, 0.9, 1.3), "white", bevel=0.05))  # wall plate
        o.append(self.cyl(0.08, 0.6, (0, 0.6, 1.3), "white", rot=(math.pi / 2, 0, 0)))
        o.append(self.cyl(0.33, 1.6, (0, -0.4, 1.38), "white", rot=(math.pi / 2 - 0.15, 0, 0), bevel=0.04))
        o.append(self.box((0.8, 1.8, 0.08), (0, -0.45, 1.78), "body", rot=(-0.15, 0, 0), bevel=0.03))
        o.append(self.cyl(0.24, 0.05, (0, -1.22, 1.26), "glass", rot=(math.pi / 2 - 0.15, 0, 0)))
        o.append(self.cyl(0.11, 0.06, (0, -1.245, 1.255), "navy" if self.brand == "ses" else "body2", rot=(math.pi / 2 - 0.15, 0, 0)))
        o.append(self.box((0.05, 0.02, 0.05), (0.2, -0.55, 1.6), "led", bevel=0))
        return o

    def dome_camera(self):
        o = [self.cyl(0.85, 0.18, (0, 0, 0.09), "white", bevel=0.05)]
        dome = self.sphere(0.62, (0, 0, 0.18), "glass", scale=(1, 1, 0.85))
        o.append(dome)
        o.append(self.sphere(0.22, (0.0, -0.32, 0.42), "body2"))
        o.append(self.cyl(0.08, 0.05, (0, -0.52, 0.48), "body", rot=(math.pi / 2 - 0.4, 0, 0)))
        return o

    def printer(self):
        o = [self.box((2.8, 1.9, 1.0), (0, 0, 0.5), "body", bevel=0.08), self.box((2.6, 1.7, 0.08), (0, 0.05, 1.03), "body2", bevel=0.03)]
        o.append(self.box((1.8, 0.04, 1.2), (0, 0.75, 1.45), "paper", rot=(-0.35, 0, 0), bevel=0.01))
        o.append(self.box((1.9, 0.8, 0.04), (0, -1.15, 0.45), "trim", bevel=0.02))
        o.append(self.box((1.7, 0.7, 0.02), (0, -1.15, 0.48), "paper", bevel=0))
        o.append(self.box((0.5, 0.4, 0.02), (-0.3, -1.1, 0.495), "accent", bevel=0))
        o.append(self.box((0.06, 0.02, 0.06), (1.1, -0.955, 0.8), "led", bevel=0))
        return o

    def binder(self, mat):
        return [self.box((0.55, 2.0, 2.4), (0, 0, 1.2), mat, bevel=0.04), self.box((0.02, 1.2, 0.5), (-0.28, 0, 1.8), "paper", bevel=0.01), self.cyl(0.12, 0.02, (-0.28, 0, 0.5), "paper", rot=(0, math.pi / 2, 0))]

    def ream(self):
        return [self.box((2.1, 1.5, 0.55), (0, 0, 0.275), "paper", bevel=0.02), self.box((2.12, 1.52, 0.25), (0, 0, 0.3), "accent", bevel=0.01), self.box((0.6, 0.02, 0.12), (0, -0.765, 0.3), "paper", bevel=0)]

    def pen_cup(self):
        o = [self.cyl(0.45, 1.0, (0, 0, 0.5), "trim", bevel=0.03)]
        for i, (x, y, t, mat, ln) in enumerate([(-0.15, 0, -0.25, "accent", 1.6), (0.1, 0.1, 0.1, "body", 1.8), (0.15, -0.12, 0.3, "gold", 1.4)]):
            o.append(self.cyl(0.055, ln, (x + math.sin(t) * ln / 2, y, 0.3 + ln / 2), mat, rot=(0, t, 0)))
        return o

    def mug(self, mat="white"):
        o = [self.cyl(0.6, 1.3, (0, 0, 0.65), mat, bevel=0.03), self.cyl(0.56, 0.05, (0, 0, 1.28), "body2")]
        o.append(self.cyl(0.605, 0.4, (0, 0, 0.7), "accent"))
        o.append(self.torus(0.32, 0.08, (0.62, 0, 0.7), mat, rot=(math.pi / 2, 0, 0)))
        return o

    def cap(self):
        crown = self.sphere(0.8, (0, 0, 0), "accent" if self.brand == "kvs" else "navy", scale=(1, 1.05, 0.75))
        cut = crown.modifiers.new("cut", "BOOLEAN")
        cutter = self.box((4, 4, 2), (0, 0, -1), None, bevel=0, name="cutter")
        cutter.hide_render = True
        cut.object = cutter
        cut.operation = "DIFFERENCE"
        brim = self.cyl(0.62, 0.05, (0, -0.85, 0.03), "body", rot=(0, 0, 0))
        brim.scale = (1.0, 1.15, 1)
        button = self.sphere(0.07, (0, 0, 0.6), "body")
        return [crown, cutter, brim, button]

    def tote(self):
        o = [self.box((1.6, 0.35, 1.8), (0, 0, 0.9), "soft" if self.brand == "kvs" else "paper", bevel=0.05)]
        o.append(self.torus(0.42, 0.04, (-0.35, 0, 1.8), "trim", rot=(math.pi / 2, 0, 0)))
        o.append(self.torus(0.42, 0.04, (0.35, 0, 1.8), "trim", rot=(math.pi / 2, 0, 0)))
        o.append(self.cyl(0.34, 0.02, (0, -0.18, 0.95), "accent", rot=(math.pi / 2, 0, 0)))
        return o

    def shield(self, mat="navy", mark="check"):
        pts = []
        for i in range(25):  # rounded bottom half
            t = i / 24
            x = 1.0 * math.cos(math.pi + t * math.pi)
            pts.append((x, -0.2 - 1.3 * math.sin(t * math.pi) * (1 - 0.15 * abs(x))))
        pts = [(1.0, 1.1), (0.0, 1.45), (-1.0, 1.1), (-1.0, -0.2)] + pts[1:] + [(1.0, -0.2)]
        # extrude_outline expects counter-clockwise points; reverse so the face points outward
        o = [self.extrude_outline(list(reversed(pts)), 0.3, (0, 0.15, 1.6), mat, bevel=0.06)]
        if mark == "check":
            # A tick from two straight strokes on the front face.
            o.append(self.box((0.56, 0.08, 0.18), (-0.275, -0.18, 1.525), "white", rot=(0, 0.785, 0), bevel=0.06))
            o.append(self.box((0.98, 0.08, 0.18), (0.2, -0.18, 1.675), "white", rot=(0, -0.825, 0), bevel=0.06))
        else:
            o += [self.box((0.7, 0.12, 0.55), (0, -0.12, 1.45), "white", bevel=0.05), self.torus(0.22, 0.06, (0, -0.12, 1.75), "white", rot=(math.pi / 2, 0, 0))]
        return o

    def padlock(self, mat="accent"):
        return [self.box((1.0, 0.45, 0.85), (0, 0, 0.425), mat, bevel=0.08), self.torus(0.32, 0.08, (0, 0, 0.9), "metal", rot=(math.pi / 2, 0, 0)), self.cyl(0.09, 0.05, (0, -0.24, 0.5), "body", rot=(math.pi / 2, 0, 0))]

    def database(self, mat="navy"):
        o = []
        for i in range(3):
            o.append(self.cyl(0.9, 0.5, (0, 0, 0.27 + i * 0.56), mat, bevel=0.04))
            o.append(self.box((0.06, 0.02, 0.06), (0.55, -0.66, 0.27 + i * 0.56), "led", bevel=0))
        return o

    def cloud(self):
        return [self.sphere(r, loc, "white") for r, loc in ((0.7, (0, 0, 0)), (0.55, (-0.75, 0, -0.15)), (0.55, (0.75, 0, -0.15)), (0.45, (-0.35, 0, 0.35)))]

    def license_card(self):
        return [self.box((2.0, 1.25, 0.06), (0, 0, 0.03), "paper", bevel=0.04), self.box((2.0, 0.3, 0.062), (0, 0.47, 0.031), "navy" if self.brand == "ses" else "accent", bevel=0.02), self.box((0.35, 0.28, 0.07), (-0.6, -0.15, 0.035), "gold", bevel=0.02)]

    def clipboard(self):
        o = [self.box((1.8, 0.08, 2.5), (0, 0, 1.25), "navy" if self.brand == "ses" else "body", rot=(-0.25, 0, 0), bevel=0.04)]
        o.append(self.box((1.55, 0.02, 2.1), (0, -0.07, 1.15), "paper", rot=(-0.25, 0, 0), bevel=0))
        o.append(self.box((0.6, 0.12, 0.25), (0, 0.06, 2.45), "metal", rot=(-0.25, 0, 0), bevel=0.03))
        for i in range(4):
            z = 1.85 - i * 0.42
            y = -0.08 - (z - 1.25) * math.tan(0.25) * -1
            o.append(self.box((0.22, 0.02, 0.22), (-0.5, y - 0.01, z), "accent" if i < 3 else "soft", rot=(-0.25, 0, 0), bevel=0.02))
            o.append(self.box((0.8, 0.02, 0.06), (0.15, y - 0.01, z), "soft", rot=(-0.25, 0, 0), bevel=0))
        return o

    # ---------- stage, lights, camera, render ----------
    def stage(self, cam_loc=(7.5, -10.5, 5.5), target=(0, 0, 1.1), lens=60):
        p = self.p
        dark = self.theme == "dark"
        bg = p["dark_bg"] if dark else p["light_bg"]
        me = bpy.data.meshes.new("floor")
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
        bm.to_mesh(me)
        bm.free()
        self._link("floor", me, self.mat("floor-" + self.theme, bg, 0.75), (0, 0, 0), (0, 0, 0))
        w = bpy.data.worlds.get("Starter world") or bpy.data.worlds.new("Starter world")
        w.use_nodes = True
        b = w.node_tree.nodes.get("Background")
        b.inputs[0].default_value = (*lin(bg), 1)
        b.inputs[1].default_value = 0.25 if dark else 0.7
        self.sc.world = w

        def light(name, energy, loc, size, color, look=(0, 0, 1)):
            d = bpy.data.lights.new(name, "AREA")
            d.energy = energy
            d.size = size
            d.color = lin(color)
            o = bpy.data.objects.new(name, d)
            self.sc.collection.objects.link(o)
            o.location = loc
            o.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        light("key", 1600 if not dark else 1900, (-6, -7, 9), 7, "#ffffff")
        light("fill", 500 if not dark else 450, (8, -5, 4), 6, p["fill"])
        light("rim", 1400 if dark else 800, (1, 8, 6), 6, p["rim"])
        cd = bpy.data.cameras.new("cam")
        cd.lens = lens
        cam = bpy.data.objects.new("cam", cd)
        self.sc.collection.objects.link(cam)
        cam.location = cam_loc
        cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
        self.sc.camera = cam
        r = self.sc.render
        r.engine = "BLENDER_EEVEE"
        r.resolution_x, r.resolution_y, r.resolution_percentage = 1600, 1067, 100
        r.image_settings.file_format = "PNG"
        self.sc.view_settings.view_transform = "AgX"
        self.sc.view_settings.look = "AgX - Medium High Contrast"
        try:
            self.sc.eevee.use_raytracing = True
            self.sc.eevee.taa_render_samples = 96
        except Exception:
            pass

    def render(self, out):
        self.sc.render.filepath = out
        bpy.ops.render.render(write_still=True, scene=self.sc.name)


# ---------- scenes: (camera location, target, lens) and devices ----------
def build(k, scene):
    g = k.group
    s = scene
    if s == "networking":
        g(k.router(), (0, 0.6, 0.27), 0.0)
        g(k.switch(14), (0, -0.4, 0), 0.0)
        k.tube([(-1.4, -0.95, 0.15), (-2.2, -0.4, 0.1), (-1.2, 0.2, 0.2)], 0.05, "accent")
        k.stage((7.0, -9.5, 5.6), (0, 0, 0.9), 62)
    elif s == "computers":
        g(k.laptop("dash"), (0, 0.3, 0), 0.0)
        g(k.keyboard(), (-0.3, -2.1, 0), 0.0, 0.8)
        g(k.mouse(), (2.4, -2.0, 0), 0.0)
        g(k.phone("app"), (2.9, 0.4, 0), -0.4, 0.9)
        k.stage((7.5, -10.5, 6.0), (0.4, -0.4, 1.0), 58)
    elif s == "computing":
        g(k.laptop("dash"), (-1.4, 0, 0), 0.25)
        g(k.server_rack(7), (2.3, 0.6, 0), -0.3)
        k.stage((7.5, -10.5, 5.8), (0.4, 0, 1.4), 55)
    elif s == "cctv":
        g(k.bullet_camera(), (-1.0, 0.6, 0), 0.45, 1.25)
        g(k.dome_camera(), (1.7, -0.9, 0), 0.0, 0.95)
        k.stage((6.5, -8.5, 4.4), (0.1, 0, 1.2), 62)
    elif s == "office":
        g(k.binder("body"), (-2.0, 0.6, 0), 0.0)
        g(k.binder("accent"), (-1.4, 0.6, 0), 0.0)
        g(k.binder("trim"), (-0.8, 0.6, 0), 0.0)
        g(k.ream(), (1.0, -0.2, 0), 0.25)
        g(k.ream(), (1.0, -0.2, 0.55), 0.15)
        g(k.pen_cup(), (2.6, 0.9, 0), 0.0)
        k.stage((7.5, -10.5, 5.8), (0.2, 0, 1.0), 58)
    elif s == "souvenirs":
        g(k.mug(), (-1.3, -0.2, 0), 0.6)
        g(k.cap(), (0.3, -0.9, 0), 0.3)
        g(k.tote(), (1.8, 0.5, 0), -0.3)
        k.stage((6.2, -8.6, 4.4), (0.2, -0.1, 0.8), 60)
    elif s == "software":
        g(k.monitor("app"), (-0.6, 0.4, 0), 0.15)
        g(k.license_card(), (1.9, -0.7, 0), -0.4, 0.9)
        k.stage((7.0, -10.0, 5.4), (0.5, 0, 1.1), 54)
    elif s == "managed":
        for i, (x, y, rz, st) in enumerate(((-1.75, 0.3, 0.2, "dash"), (1.75, 0.3, -0.2, "alert"))):
            g(k.monitor(st, 3.0, 1.8), (x, y, 0), rz)
        g(k.server_rack(5), (0, 2.6, 0), 0.0, 0.8)
        k.stage((7.5, -11.5, 6.0), (0, 0.6, 1.4), 55)
    elif s == "professional":
        g(k.clipboard(), (-1.5, 0.3, 0), 0.2)
        g(k.laptop("dash"), (1.6, 0, 0), -0.25, 0.85)
        k.stage((7.5, -10.5, 5.6), (0, 0, 1.2), 56)
    elif s == "security":
        g(k.shield("navy" if k.brand == "ses" else "accent", "check"), (-1.0, 0.5, 0), 0.25)
        g(k.dome_camera(), (1.9, -0.4, 0), 0.0)
        g(k.padlock(), (1.0, -1.6, 0), -0.3, 0.8)
        k.stage((7.0, -10.0, 5.2), (0.2, 0, 1.2), 56)
    elif s == "hero-kvs":
        g(k.laptop("app"), (0, 0.4, 0), 0.0)
        g(k.bullet_camera(), (-3.4, 1.2, 0.2), 0.6, 0.8)
        g(k.router(), (-1.6, -1.8, 0), 0.2, 0.7)
        g(k.mug(), (2.9, -1.3, 0), 0.4, 0.8)
        g(k.printer(), (3.6, 1.6, 0), -0.3, 0.7)
        k.stage((7.9, -11.2, 5.4), (0.7, 0, 0.9), 54)
    elif s == "web":
        g(k.monitor("app", 3.6, 2.1), (-0.5, 0.6, 0), 0.15)
        g(k.laptop("code"), (2.3, -1.0, 0), -0.35, 0.75)
        g(k.phone("app"), (-2.8, -1.0, 0), 0.35, 0.85)
        k.stage((8.0, -11.5, 6.0), (0, 0, 1.3), 52)
    elif s == "hero-ses":
        g(k.server_rack(7), (-3.0, 1.0, 0), 0.3, 0.9)
        g(k.laptop("dash"), (0, 0, 0), 0.0)
        g(k.shield("accent", "check"), (3.0, 1.0, 0), -0.3, 0.9)
        g(k.router(), (2.2, -1.9, 0), -0.2, 0.6)
        g(k.cloud(), (-0.5, 2.5, 3.6), 0.0, 0.8)
        k.stage((8.5, -12.5, 6.0), (0, 0, 1.4), 48)
    elif s == "integration":
        g(k.monitor("code"), (-2.4, 0.5, 0), 0.3, 0.8)
        g(k.monitor("dash"), (2.4, 0.5, 0), -0.3, 0.8)
        k.tube([(-1.2, 0.3, 1.6), (0, -0.6, 1.9), (1.2, 0.3, 1.6)], 0.07, "accent")
        g(k.database("navy"), (0, 0.8, 0), 0.0, 0.7)
        k.stage((7.5, -11.5, 5.4), (0, 0.3, 1.4), 52)
    elif s == "security-slide":
        g(k.shield("accent", "check"), (0, 0.6, 0), 0.0, 1.2)
        g(k.server_rack(6), (-2.8, 0.8, 0), 0.35, 0.85)
        g(k.database("navy"), (2.6, 0.2, 0), 0.0, 0.8)
        k.stage((7.5, -11.0, 5.0), (0, 0, 1.6), 52)
    elif s == "network-slide":
        g(k.router(), (-1.4, 0.4, 0), 0.25)
        g(k.switch(12), (1.4, -0.9, 0), -0.2, 0.8)
        g(k.laptop("dash"), (2.6, 1.0, 0), -0.4, 0.7)
        k.tube([(-0.4, -0.3, 0.1), (0.3, -0.8, 0.05), (0.8, -0.95, 0.15)], 0.05, "accent")
        k.stage((7.5, -11.0, 5.6), (0.4, 0, 1.0), 54)
    elif s == "hardware":
        g(k.laptop("dash"), (-1.3, 0, 0), 0.25)
        g(k.server_rack(7), (2.0, 0.9, 0), -0.25, 0.9)
        g(k.license_card(), (1.6, -1.8, 0), -0.3, 0.8)
        k.stage((7.5, -11.0, 5.8), (0.3, 0, 1.3), 54)
    else:
        raise ValueError("Unknown scene " + scene)


def main(args):
    brand, scene, theme, out = args
    k = Kit(brand, theme)
    build(k, scene)
    k.render(out)
    return out


if "ARGS" in globals():
    RESULT = main(globals()["ARGS"])
elif "--" in sys.argv:
    main(sys.argv[sys.argv.index("--") + 1:])
