import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

BASE_PUBLIC = r"E:\ai\cyber-survivors-3d\public"
MODEL_DIR = os.path.join(BASE_PUBLIC, "models")
UI_DIR = os.path.join(BASE_PUBLIC, "ui")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(UI_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_lin(c):
    return pow(c / 255.0, 2.2)


def hex_rgba(hex_rgb):
    return (
        srgb_to_lin((hex_rgb >> 16) & 0xFF),
        srgb_to_lin((hex_rgb >> 8) & 0xFF),
        srgb_to_lin(hex_rgb & 0xFF),
        1.0,
    )


def make_vcol_mat(name, metallic=0.72, roughness=0.34, emission_strength=0.45):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    vcol = nt.nodes.new(type='ShaderNodeVertexColor')
    vcol.layer_name = "Color"
    nt.links.new(vcol.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if 'Emission Color' in bsdf.inputs:
        nt.links.new(vcol.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


def make_pbr_mat(name, hex_rgb, metallic=0.78, roughness=0.24, emit_hex=None, emit_str=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = hex_rgba(hex_rgb)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emit_hex is not None and emit_str > 0 and 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = hex_rgba(emit_hex)
        bsdf.inputs['Emission Strength'].default_value = emit_str
    return mat


def stamp_part(target_bm, target_col, part_bm, rgba, loc=(0, 0, 0), rot=(0, 0, 0)):
    bmesh.ops.recalc_face_normals(part_bm, faces=part_bm.faces)
    mat_xform = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    bmesh.ops.transform(part_bm, matrix=mat_xform, verts=part_bm.verts)
    vmap = {v: target_bm.verts.new(v.co) for v in part_bm.verts}
    for f in part_bm.faces:
        try:
            nf = target_bm.faces.new([vmap[v] for v in f.verts])
            for loop in nf.loops:
                loop[target_col] = rgba
        except ValueError:
            pass
    part_bm.free()


def add_box_vc(bm, col, sx, sy, sz, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.02):
    p = bmesh.new()
    bmesh.ops.create_cube(p, size=1.0)
    bmesh.ops.scale(p, vec=(sx, sy, sz), verts=p.verts)
    if bevel > 0:
        bmesh.ops.bevel(p, geom=list(p.edges), offset=bevel, segments=1, affect='EDGES')
    stamp_part(bm, col, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def add_cone_vc(bm, col, r1, r2, depth, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), segs=8):
    p = bmesh.new()
    bmesh.ops.create_cone(p, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    stamp_part(bm, col, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def finalize_vc_obj(name, bm, mat):
    mesh = bpy.data.meshes.new(name + "_m")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def export_glb(filepath):
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
    )
    print(f"Exported GLB: {filepath} ({os.path.getsize(filepath)} bytes)")


# =========================================================================
# 1. 3D Cyber-Ruins Map Environment Props (map_props.glb)
# =========================================================================
def build_map_props():
    clear_scene()
    mat = make_vcol_mat("MapPropVColMat", metallic=0.72, roughness=0.36, emission_strength=0.45)

    # Prop_HoloPylon: 4.0m Cyber Relay Obelisk with Glowing Cyan Strips & Halo Ring
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.95, 0.78, 0.36, 0x1e293b, loc=(0, 0, 0.18), segs=6)
    add_cone_vc(bm, col, 0.56, 0.32, 3.2, 0x0f172a, loc=(0, 0, 1.92), segs=6)
    for k in range(3):
        ang = k * (math.tau / 3)
        add_box_vc(bm, col, 0.08, 0.14, 2.7, 0x22d3ee, loc=(math.cos(ang) * 0.44, math.sin(ang) * 0.44, 1.95), rot=(0, 0, ang), bevel=0.01)
    add_cone_vc(bm, col, 0.78, 0.78, 0.10, 0xa855f7, loc=(0, 0, 3.15), segs=12)
    add_cone_vc(bm, col, 0.24, 0.02, 0.65, 0x67e8f9, loc=(0, 0, 3.82), segs=6)
    finalize_vc_obj("Prop_HoloPylon", bm, mat)

    # Prop_CargoCrate: Armored Sci-Fi Supply Container with Hazard Bumpers
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_box_vc(bm, col, 2.1, 1.35, 1.28, 0x1e293b, loc=(0, 0, 0.64), bevel=0.05)
    for sx in (-1, 1):
        add_box_vc(bm, col, 0.22, 1.42, 1.34, 0x334155, loc=(sx * 0.82, 0, 0.67), bevel=0.03)
        add_box_vc(bm, col, 0.24, 1.44, 0.16, 0xf59e0b, loc=(sx * 0.82, 0, 1.26), bevel=0.01)
    add_box_vc(bm, col, 1.25, 1.38, 0.14, 0x22d3ee, loc=(0, 0, 0.68), bevel=0.01)
    finalize_vc_obj("Prop_CargoCrate", bm, mat)

    # Prop_PlasmaBarrel: Shootable Destructible Explosive Energy Cell!
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.46, 0.46, 0.18, 0x18181b, loc=(0, 0, 0.09), segs=10)
    add_cone_vc(bm, col, 0.40, 0.40, 0.92, 0xff5500, loc=(0, 0, 0.62), segs=10)
    add_cone_vc(bm, col, 0.47, 0.47, 0.16, 0x18181b, loc=(0, 0, 1.12), segs=10)
    for k in range(4):
        ang = k * (math.pi / 2)
        add_box_vc(bm, col, 0.08, 0.08, 1.02, 0x27272a, loc=(math.cos(ang) * 0.43, math.sin(ang) * 0.43, 0.62), bevel=0.01)
    add_cone_vc(bm, col, 0.22, 0.22, 0.08, 0xfef08a, loc=(0, 0, 1.23), segs=8)
    finalize_vc_obj("Prop_PlasmaBarrel", bm, mat)

    export_glb(os.path.join(MODEL_DIR, "map_props.glb"))


# =========================================================================
# 2. 3D Projectiles, Serrated Buzzsaws, Data Crystals & Orbital Drop Pods
# =========================================================================
def build_weapons_and_loot():
    clear_scene()
    mat = make_vcol_mat("WpnLootVColMat", metallic=0.65, roughness=0.25, emission_strength=0.75)

    # Weapon_Kunai: Oriented along -Z in glTF (+Y in Blender -> -Z in glTF!)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    # Blade tip toward +Y (which exports to -Z in glTF Y-up!)
    add_cone_vc(bm, col, 0.22, 0.01, 0.78, 0x67e8f9, loc=(0, 0.32, 0), rot=(-math.pi / 2, 0, 0), segs=4)
    add_box_vc(bm, col, 0.42, 0.10, 0.06, 0xfbbf24, loc=(0, -0.08, 0), bevel=0.01)
    add_box_vc(bm, col, 0.08, 0.28, 0.08, 0x1e293b, loc=(0, -0.24, 0), bevel=0.01)
    add_cone_vc(bm, col, 0.11, 0.11, 0.05, 0x22d3ee, loc=(0, -0.42, 0), segs=8)
    finalize_vc_obj("Weapon_Kunai", bm, mat)

    # Weapon_Saw: 8-Toothed Serrated Cyber Buzzsaw Chakram
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.44, 0.44, 0.09, 0x1e293b, loc=(0, 0, 0), segs=16)
    add_cone_vc(bm, col, 0.26, 0.26, 0.13, 0xfef08a, loc=(0, 0, 0), segs=12)
    for k in range(8):
        ang = k * (math.tau / 8)
        tx = math.cos(ang) * 0.52
        ty = math.sin(ang) * 0.52
        add_cone_vc(bm, col, 0.14, 0.01, 0.34, 0xf43f5e, loc=(tx, ty, 0), rot=(math.pi / 2, 0, ang - 0.55), segs=4)
    finalize_vc_obj("Weapon_Saw", bm, mat)

    # Loot_Crystal: Clustered Multi-Spire Cyber Data-Crystal
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.22, 0.02, 0.62, 0xffffff, loc=(0, 0, 0.32), segs=6)
    add_cone_vc(bm, col, 0.14, 0.02, 0.42, 0xdbeafe, loc=(0.14, 0.06, 0.22), rot=(0.15, 0.32, 0), segs=5)
    add_cone_vc(bm, col, 0.13, 0.02, 0.38, 0xdbeafe, loc=(-0.13, -0.08, 0.20), rot=(-0.18, -0.28, 0), segs=5)
    finalize_vc_obj("Loot_Crystal", bm, mat)

    # Loot_HyperPod: Hexagonal Golden Orbital Supply Pod
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.68, 0.58, 0.24, 0x1e293b, loc=(0, 0, 0.12), segs=6)
    add_cone_vc(bm, col, 0.52, 0.52, 0.64, 0xfbbf24, loc=(0, 0, 0.52), segs=6)
    add_cone_vc(bm, col, 0.36, 0.36, 0.72, 0xfef08a, loc=(0, 0, 0.56), segs=6)
    for k in range(3):
        ang = k * (math.tau / 3)
        add_box_vc(bm, col, 0.14, 0.18, 0.76, 0x78350f, loc=(math.cos(ang) * 0.54, math.sin(ang) * 0.54, 0.50), rot=(0, 0, ang), bevel=0.02)
    finalize_vc_obj("Loot_HyperPod", bm, mat)

    export_glb(os.path.join(MODEL_DIR, "weapons_and_loot.glb"))


# =========================================================================
# 3. Studio Cycles Raytraced 3D RGBA Illustrations for ALL 19 UI Icons & Mechs!
# =========================================================================
def setup_icon_studio():
    clear_scene()
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 20
    scn.cycles.use_denoising = False
    scn.render.resolution_x = 192
    scn.render.resolution_y = 192
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGBA'

    # Dark cyber world reflection
    world = bpy.data.worlds.new("StudioWorld")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.04, 0.09, 1.0)
        bg.inputs[1].default_value = 0.9

    # Camera looking at origin (0, 0, 0) from 3/4 isometric studio angle
    cam_data = bpy.data.cameras.new("StudioCam")
    cam_data.lens = 58
    cam = bpy.data.objects.new("StudioCam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.location = (2.35, -2.55, 1.85)
    direction = Vector((0, 0, 0.05)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

    # 3-Point Studio Rim Lighting
    def add_light(name, loc, energy, hex_rgb, size=1.5):
        ld = bpy.data.lights.new(name=name, type='AREA')
        ld.energy = energy
        ld.size = size
        c = hex_rgba(hex_rgb)
        ld.color = (c[0], c[1], c[2])
        lo = bpy.data.objects.new(name, ld)
        scn.collection.objects.link(lo)
        lo.location = loc
        d = Vector((0, 0, 0)) - lo.location
        lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    add_light("KeyLight", (3.0, -2.5, 3.2), 140, 0xffffff, 2.2)
    add_light("CyanRim", (-2.8, 1.8, 2.0), 110, 0x22d3ee, 1.8)
    add_light("MagFill", (1.8, 2.6, -1.2), 85, 0xc084fc, 1.8)

    subject = bpy.data.objects.new("SubjectRoot", None)
    scn.collection.objects.link(subject)
    return scn, subject


def clear_children(root):
    for ch in list(root.children):
        m = ch.data
        bpy.data.objects.remove(ch, do_unlink=True)
        if m and hasattr(bpy.data.meshes, "remove") and isinstance(m, bpy.types.Mesh):
            bpy.data.meshes.remove(m, do_unlink=True)


def add_mesh_prim(kind, name, scale, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), segs=16):
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.035, segments=2, affect='EDGES')
    elif kind == 'cone':
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=scale[0], radius2=scale[1], depth=scale[2])
    elif kind == 'sphere':
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    elif kind == 'torus':
        # Build clean polygonal ring via loft
        R, r = scale[0], scale[1]
        u_n, v_n = 24, 10
        rings = []
        for iu in range(u_n):
            u = iu * math.tau / u_n
            ring = []
            for iv in range(v_n):
                v = iv * math.tau / v_n
                rr = R + math.cos(v) * r
                ring.append(bm.verts.new((math.cos(u) * rr, math.sin(u) * rr, math.sin(v) * r)))
            rings.append(ring)
        for iu in range(u_n):
            r0 = rings[iu]
            r1 = rings[(iu + 1) % u_n]
            for iv in range(v_n):
                nv = (iv + 1) % v_n
                bm.faces.new((r0[iv], r0[nv], r1[nv], r1[iv]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name + "_im")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = (kind in ('sphere', 'torus'))
    mesh.materials.append(mat)
    o = bpy.data.objects.new(name, mesh)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)
    return o


def render_icon(scn, filename):
    out = os.path.join(UI_DIR, filename)
    scn.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print(f"Rendered 3D icon: {filename}")


def render_all_19_icons():
    scn, root = setup_icon_studio()
    m_steel = make_pbr_mat("ISteel", 0x1e293b, 0.85, 0.22)
    m_silver = make_pbr_mat("ISilver", 0x94a3b8, 0.9, 0.18)
    m_gold = make_pbr_mat("IGold", 0xfbbf24, 0.9, 0.16, 0xf59e0b, 0.7)
    m_cyan = make_pbr_mat("ICyan", 0x22d3ee, 0.2, 0.15, 0x22d3ee, 2.4)
    m_red = make_pbr_mat("IRed", 0xf43f5e, 0.3, 0.18, 0xf43f5e, 2.2)
    m_violet = make_pbr_mat("IViolet", 0xa855f7, 0.3, 0.18, 0xc084fc, 2.3)
    m_green = make_pbr_mat("IGreen", 0x10b981, 0.25, 0.18, 0x34d399, 2.3)
    m_white = make_pbr_mat("IWhite", 0xffffff, 0.1, 0.1, 0xfef08a, 3.0)

    # 1. wpn_kunai.png
    clear_children(root)
    add_mesh_prim('cone', 'Blade', (0.32, 0.02, 1.35), m_cyan, root, loc=(0, 0, 0.25), rot=(0.35, -0.45, 0), segs=4)
    add_mesh_prim('box', 'Guard', (0.65, 0.16, 0.12), m_silver, root, loc=(-0.18, -0.14, -0.22), rot=(0.35, -0.45, 0))
    add_mesh_prim('torus', 'Ring', (0.18, 0.05, 0), m_gold, root, loc=(-0.36, -0.28, -0.55), rot=(0.9, 0.2, 0))
    render_icon(scn, "wpn_kunai.png")

    # 2. wpn_kunai_hyper.png (Twin Helix Golden-Cyan Phantom Blades)
    clear_children(root)
    for sx, mat_b in ((-0.32, m_cyan), (0.32, m_gold)):
        add_mesh_prim('cone', f'HB_{sx}', (0.28, 0.01, 1.45), mat_b, root, loc=(sx, 0, 0.15), rot=(0.25, -0.35 * sx, 0.2), segs=4)
    add_mesh_prim('torus', 'Halo', (0.72, 0.05, 0), m_gold, root, rot=(0.6, 0.3, 0))
    render_icon(scn, "wpn_kunai_hyper.png")

    # 3. wpn_saw.png
    clear_children(root)
    add_mesh_prim('torus', 'SawRim', (0.62, 0.10, 0), m_steel, root, rot=(0.55, -0.3, 0))
    add_mesh_prim('sphere', 'SawHub', (0.28, 0.28, 0.16), m_red, root, rot=(0.55, -0.3, 0))
    for k in range(8):
        a = k * math.tau / 8
        add_mesh_prim('cone', f'Tooth_{k}', (0.16, 0.02, 0.38), m_red, root, loc=(math.cos(a) * 0.72, math.sin(a) * 0.58, math.sin(a) * 0.32), rot=(0.55, -0.3, a), segs=4)
    render_icon(scn, "wpn_saw.png")

    # 4. wpn_saw_hyper.png (Solar Corona Dual Halo)
    clear_children(root)
    add_mesh_prim('torus', 'OuterR', (0.78, 0.09, 0), m_gold, root, rot=(0.5, -0.25, 0))
    add_mesh_prim('torus', 'InnerR', (0.46, 0.08, 0), m_red, root, rot=(-0.45, 0.35, 0))
    add_mesh_prim('sphere', 'SunCore', (0.30, 0.30, 0.30), m_white, root)
    render_icon(scn, "wpn_saw_hyper.png")

    # 5. wpn_arc.png (Tesla Emitter Coil)
    clear_children(root)
    add_mesh_prim('cone', 'Base', (0.48, 0.32, 0.85), m_steel, root, loc=(0, 0, -0.28), segs=12)
    for i, z in enumerate((-0.15, 0.12, 0.38)):
        add_mesh_prim('torus', f'Coil_{i}', (0.46 - i * 0.06, 0.055, 0), m_violet, root, loc=(0, 0, z))
    add_mesh_prim('sphere', 'TopOrb', (0.26, 0.26, 0.26), m_cyan, root, loc=(0, 0, 0.68))
    render_icon(scn, "wpn_arc.png")

    # 6. wpn_arc_hyper.png (Thor Matrix Storm Core)
    clear_children(root)
    add_mesh_prim('sphere', 'StormOrb', (0.42, 0.42, 0.42), m_violet, root)
    add_mesh_prim('torus', 'RingA', (0.76, 0.06, 0), m_cyan, root, rot=(0.8, 0.2, 0))
    add_mesh_prim('torus', 'RingB', (0.76, 0.06, 0), m_gold, root, rot=(-0.7, 0.5, 0))
    render_icon(scn, "wpn_arc_hyper.png")

    # 7. wpn_laser.png (Rail Sweep Emitter Barrel)
    clear_children(root)
    add_mesh_prim('box', 'Housing', (0.52, 1.15, 0.44), m_steel, root, rot=(0.25, 0, -0.55))
    add_mesh_prim('box', 'CoreBeam', (0.18, 1.48, 0.18), m_cyan, root, rot=(0.25, 0, -0.55))
    add_mesh_prim('torus', 'Muzzle', (0.34, 0.06, 0), m_silver, root, loc=(0.35, -0.45, 0.18), rot=(1.1, 0, -0.55))
    render_icon(scn, "wpn_laser.png")

    # 8. wpn_laser_hyper.png (Prism Obliterator 4-Cross Star)
    clear_children(root)
    add_mesh_prim('box', 'BeamX', (1.65, 0.20, 0.20), m_gold, root, rot=(0.2, 0.2, 0.4))
    add_mesh_prim('box', 'BeamY', (0.20, 1.65, 0.20), m_cyan, root, rot=(0.2, 0.2, 0.4))
    add_mesh_prim('cone', 'Prism', (0.44, 0.02, 0.72), m_white, root, loc=(0, 0, 0.05), segs=6)
    render_icon(scn, "wpn_laser_hyper.png")

    # 9-14. 6 Passive Cyber-Chips + 2 Modules
    # cooler
    clear_children(root)
    add_mesh_prim('box', 'ChipBase', (1.05, 1.05, 0.22), m_steel, root, rot=(0.35, -0.25, 0.4))
    add_mesh_prim('torus', 'FanRim', (0.42, 0.07, 0), m_cyan, root, loc=(0, 0, 0.14), rot=(0.35, -0.25, 0.4))
    add_mesh_prim('sphere', 'CryoCore', (0.22, 0.22, 0.18), m_white, root, loc=(0, 0, 0.18))
    render_icon(scn, "chip_cooler.png")

    # amp
    clear_children(root)
    add_mesh_prim('cone', 'Dish', (0.72, 0.14, 0.36), m_silver, root, loc=(0, 0, -0.05), rot=(-0.45, 0.3, 0), segs=18)
    add_mesh_prim('torus', 'Wave1', (0.42, 0.045, 0), m_cyan, root, loc=(-0.15, -0.25, 0.35), rot=(-0.45, 0.3, 0))
    add_mesh_prim('torus', 'Wave2', (0.66, 0.045, 0), m_gold, root, loc=(-0.22, -0.35, 0.52), rot=(-0.45, 0.3, 0))
    render_icon(scn, "chip_amp.png")

    # splitter
    clear_children(root)
    add_mesh_prim('sphere', 'Hub', (0.28, 0.28, 0.28), m_violet, root)
    for k in range(3):
        a = k * math.tau / 3
        add_mesh_prim('cone', f'Shard_{k}', (0.20, 0.02, 0.72), m_cyan, root, loc=(math.cos(a) * 0.52, math.sin(a) * 0.52, 0.12), rot=(0.4, 0, a), segs=5)
    render_icon(scn, "chip_splitter.png")

    # capacitor
    clear_children(root)
    for sx in (-0.32, 0.32):
        add_mesh_prim('cone', f'Cell_{sx}', (0.26, 0.26, 1.05), m_gold, root, loc=(sx, 0, 0), segs=14)
        add_mesh_prim('cone', f'Cap_{sx}', (0.28, 0.28, 0.18), m_steel, root, loc=(sx, 0, 0.54), segs=14)
    add_mesh_prim('box', 'Bridge', (0.85, 0.22, 0.14), m_cyan, root, loc=(0, 0, 0.66))
    render_icon(scn, "chip_capacitor.png")

    # magnet
    clear_children(root)
    add_mesh_prim('torus', 'Arch', (0.52, 0.16, 0), m_red, root, loc=(0, 0, 0.12), rot=(1.2, 0, 0.4))
    add_mesh_prim('box', 'TipL', (0.28, 0.28, 0.36), m_cyan, root, loc=(-0.48, -0.15, -0.32))
    add_mesh_prim('box', 'TipR', (0.28, 0.28, 0.36), m_cyan, root, loc=(0.48, 0.15, -0.32))
    render_icon(scn, "chip_magnet.png")

    # armor
    clear_children(root)
    add_mesh_prim('cone', 'ShieldPlate', (0.82, 0.76, 0.20), m_steel, root, rot=(1.05, 0, -0.45), segs=6)
    add_mesh_prim('cone', 'ShieldRim', (0.62, 0.58, 0.24), m_green, root, rot=(1.05, 0, -0.45), segs=6)
    render_icon(scn, "chip_armor.png")

    # heal
    clear_children(root)
    add_mesh_prim('box', 'CrossH', (1.15, 0.36, 0.32), m_green, root, rot=(0.4, -0.3, 0.2))
    add_mesh_prim('box', 'CrossV', (0.36, 0.32, 1.15), m_green, root, rot=(0.4, -0.3, 0.2))
    render_icon(scn, "mod_heal.png")

    # overclock
    clear_children(root)
    add_mesh_prim('sphere', 'Core', (0.44, 0.44, 0.44), m_red, root)
    add_mesh_prim('torus', 'Orbit', (0.74, 0.08, 0), m_gold, root, rot=(0.65, -0.4, 0))
    render_icon(scn, "mod_overclock.png")

    # 17-19. 3 Hero Mech Bust Portraits (mech_striker, mech_aegis, mech_nexus)
    for m_id, m_accent in (("striker", m_cyan), ("aegis", m_red), ("nexus", m_violet)):
        clear_children(root)
        add_mesh_prim('box', 'Chest', (0.92, 0.58, 0.66), m_steel, root, loc=(0, 0, -0.22))
        add_mesh_prim('box', 'CoreLight', (0.38, 0.14, 0.28), m_accent, root, loc=(0, -0.28, -0.18))
        add_mesh_prim('box', 'Helm', (0.48, 0.48, 0.44), m_steel, root, loc=(0, -0.04, 0.36))
        add_mesh_prim('box', 'Visor', (0.42, 0.12, 0.12), m_gold if m_id == "striker" else m_accent, root, loc=(0, -0.26, 0.38))
        if m_id == "striker":
            for sx in (-1, 1):
                add_mesh_prim('box', f'Wing_{sx}', (0.95, 0.08, 0.24), m_cyan, root, loc=(sx * 0.68, 0.28, 0.15), rot=(0.2, -sx * 0.45, 0))
                add_mesh_prim('box', f'VFin_{sx}', (0.38, 0.06, 0.08), m_gold, root, loc=(sx * 0.24, -0.26, 0.60), rot=(0, -sx * 0.45, 0))
        elif m_id == "aegis":
            for sx in (-1, 1):
                add_mesh_prim('box', f'Pod_{sx}', (0.42, 0.48, 0.44), m_red, root, loc=(sx * 0.64, 0.06, 0.22))
                add_mesh_prim('box', f'War_{sx}', (0.32, 0.10, 0.32), m_gold, root, loc=(sx * 0.64, -0.18, 0.22))
        else:
            for sx in (-1, 1):
                add_mesh_prim('box', f'FunU_{sx}', (0.16, 0.16, 0.95), m_violet, root, loc=(sx * 0.78, 0.24, 0.18), rot=(0, sx * 0.42, 0))
                add_mesh_prim('box', f'FunL_{sx}', (0.14, 0.14, 0.78), m_gold, root, loc=(sx * 0.62, 0.28, -0.28), rot=(0, -sx * 0.42, 0))
        render_icon(scn, f"mech_{m_id}.png")


if __name__ == "__main__":
    build_map_props()
    build_weapons_and_loot()
    render_all_19_icons()
    print("=== ALL MAP PROPS, WEAPON LOOT GLBS & 19 STUDIO ICONS COMPLETE ===")
