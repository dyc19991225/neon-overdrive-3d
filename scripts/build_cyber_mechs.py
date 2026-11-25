import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

OUT_DIR = r"E:\ai\cyber-survivors-3d\public\models"
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_lin(c):
    return pow(c / 255.0, 2.2)


def hex_rgba(hex_rgb):
    r = srgb_to_lin((hex_rgb >> 16) & 0xFF)
    g = srgb_to_lin((hex_rgb >> 8) & 0xFF)
    b = srgb_to_lin(hex_rgb & 0xFF)
    return (r, g, b, 1.0)


def make_vcol_pbr_mat(name, metallic=0.68, roughness=0.34, emission_strength=0.35):
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


def make_solid_mat(name, hex_rgb, metallic=0.72, roughness=0.3, emission_hex=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = hex_rgba(hex_rgb)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission_hex is not None and emission_strength > 0:
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = hex_rgba(emission_hex)
            bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


def stamp_part(target_bm, target_col, part_bm, rgba, loc=(0, 0, 0), rot=(0, 0, 0)):
    bmesh.ops.recalc_face_normals(part_bm, faces=part_bm.faces)
    mat_xform = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    bmesh.ops.transform(part_bm, matrix=mat_xform, verts=part_bm.verts)

    vert_map = {}
    for v in part_bm.verts:
        nv = target_bm.verts.new(v.co)
        vert_map[v] = nv
    for f in part_bm.faces:
        try:
            nf = target_bm.faces.new([vert_map[v] for v in f.verts])
            for loop in nf.loops:
                loop[target_col] = rgba
        except ValueError:
            pass
    part_bm.free()


def add_box_part(bm, col_layer, sx, sy, sz, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.02):
    p = bmesh.new()
    bmesh.ops.create_cube(p, size=1.0)
    bmesh.ops.scale(p, vec=(sx, sy, sz), verts=p.verts)
    if bevel > 0:
        bmesh.ops.bevel(p, geom=list(p.edges), offset=bevel, segments=1, affect='EDGES')
    stamp_part(bm, col_layer, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def add_cone_part(bm, col_layer, r1, r2, depth, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), segs=8):
    p = bmesh.new()
    bmesh.ops.create_cone(p, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    stamp_part(bm, col_layer, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def add_icosphere_part(bm, col_layer, rx, ry, rz, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), subdiv=1):
    p = bmesh.new()
    bmesh.ops.create_icosphere(p, subdivisions=subdiv, radius=1.0)
    bmesh.ops.scale(p, vec=(rx, ry, rz), verts=p.verts)
    stamp_part(bm, col_layer, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def finalize_vcol_obj(name, bm, mat, loc=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def export_glb(filepath):
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
    )
    print(f"Exported: {filepath} ({os.path.getsize(filepath)} bytes)")


# =========================================================================
# 1. Build 4 Single-Draw-Call Hard-Surface Enemy Mechs (enemy_mechs.glb)
# Blender axes: X = right, Y = back (-Y is glTF +Z / forward in Blender -Y->+Z), Z = up!
# Wait: in Blender Y-up glTF export: Blender (x, y, z) -> glTF (x, z, -y).
# In our game, `dummy.rotation.y = Math.atan2(dx, dz)` points local +Z toward player!
# Local +Z in glTF corresponds to Blender **-Y**! So front of mech = **negative Y**!
# =========================================================================
def build_enemy_mechs():
    clear_scene()
    mat = make_vcol_pbr_mat("EnemyMechVColMat", metallic=0.65, roughness=0.35, emission_strength=0.42)

    # ---------------------------------------------------------------------
    # Type 0: Enemy_Crawler — Quad-Legged Cyber Spider-Hound Mech
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    # Armored sloped chassis & abdomen
    add_box_part(bm, col, 0.56, 0.72, 0.30, 0x4c1d95, loc=(0, 0.04, 0.46), bevel=0.05)
    add_box_part(bm, col, 0.42, 0.46, 0.24, 0x7e22ce, loc=(0, 0.42, 0.54), rot=(0.2, 0, 0), bevel=0.04)
    # Glowing Twin Cyber Visor Eyes + Front Plasma Fangs (-Y front)
    add_box_part(bm, col, 0.44, 0.12, 0.11, 0xff2a85, loc=(0, -0.34, 0.48), bevel=0.01)
    for sx in (-1, 1):
        add_cone_part(bm, col, 0.07, 0.01, 0.34, 0xe879f9, loc=(sx * 0.18, -0.46, 0.38), rot=(math.pi / 2, 0, sx * 0.18), segs=6)
    # Rear Glowing Core Vent
    add_cone_part(bm, col, 0.14, 0.08, 0.18, 0xf43f5e, loc=(0, 0.66, 0.54), rot=(-math.pi / 2, 0, 0), segs=8)
    # 4 Articulated Spider Legs (upper femur + lower shin + foot pad)
    for sx in (-1, 1):
        for fy in (-0.22, 0.24):
            add_box_part(bm, col, 0.36, 0.11, 0.10, 0x1e293b, loc=(sx * 0.40, fy, 0.52), rot=(0, sx * 0.42, sx * fy * 0.5), bevel=0.015)
            add_box_part(bm, col, 0.10, 0.11, 0.48, 0x334155, loc=(sx * 0.58, fy * 1.15, 0.25), rot=(0, -sx * 0.18, 0), bevel=0.015)
            add_box_part(bm, col, 0.16, 0.20, 0.07, 0xa855f7, loc=(sx * 0.62, fy * 1.15, 0.04), bevel=0.01)
    finalize_vcol_obj("Enemy_Crawler", bm, mat, loc=(0, 0, 0))

    # ---------------------------------------------------------------------
    # Type 1: Enemy_Kamikaze — 6-Legged Volatile Plasma Reactor Walker
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    # Heavy Dark Iron Base Chassis
    add_cone_part(bm, col, 0.42, 0.34, 0.26, 0x27272a, loc=(0, 0, 0.32), segs=8)
    # Giant Volatile Glowing Orange-Gold Plasma Sphere on Back
    add_icosphere_part(bm, col, 0.38, 0.38, 0.36, 0xff8800, loc=(0, 0.04, 0.64), subdiv=2)
    # Hazard Roll-Cage Straps + Blinking Beacon Horn
    add_box_part(bm, col, 0.82, 0.08, 0.46, 0x18181b, loc=(0, 0.04, 0.65), bevel=0.01)
    add_box_part(bm, col, 0.08, 0.82, 0.46, 0x18181b, loc=(0, 0.04, 0.65), bevel=0.01)
    add_cone_part(bm, col, 0.08, 0.02, 0.28, 0xfef08a, loc=(0, 0.04, 1.08), segs=6)
    # Front Red Cyclops Detonator Sensor
    add_icosphere_part(bm, col, 0.14, 0.10, 0.12, 0xff1e42, loc=(0, -0.38, 0.36), subdiv=1)
    # 6 Scuttling Bomb-Bot Legs
    for sx in (-1, 1):
        for ly in (-0.28, 0.0, 0.28):
            add_box_part(bm, col, 0.32, 0.08, 0.08, 0x3f3f46, loc=(sx * 0.42, ly, 0.32), rot=(0, sx * 0.5, 0), bevel=0.01)
            add_box_part(bm, col, 0.08, 0.08, 0.34, 0xf97316, loc=(sx * 0.56, ly, 0.16), bevel=0.01)
    finalize_vcol_obj("Enemy_Kamikaze", bm, mat, loc=(0, 0, 0))

    # ---------------------------------------------------------------------
    # Type 2: Enemy_ShieldMech — Bipedal Riot-Shield Combat Mech
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    # Bipedal Mech Legs + Knee Armor + Feet
    for sx in (-1, 1):
        add_box_part(bm, col, 0.24, 0.34, 0.12, 0x1e293b, loc=(sx * 0.22, -0.04, 0.06), bevel=0.02)
        add_box_part(bm, col, 0.20, 0.22, 0.42, 0x0f2942, loc=(sx * 0.22, 0.0, 0.32), bevel=0.02)
        add_box_part(bm, col, 0.22, 0.12, 0.18, 0x38bdf8, loc=(sx * 0.22, -0.12, 0.48), bevel=0.02)
        add_box_part(bm, col, 0.22, 0.24, 0.34, 0x1e293b, loc=(sx * 0.22, 0.02, 0.66), bevel=0.02)
    # Pelvis & Broad Armored Chestplate
    add_box_part(bm, col, 0.56, 0.34, 0.18, 0x334155, loc=(0, 0, 0.86), bevel=0.02)
    add_box_part(bm, col, 0.72, 0.48, 0.48, 0x0284c7, loc=(0, 0, 1.18), bevel=0.05)
    add_box_part(bm, col, 0.34, 0.10, 0.18, 0x67e8f9, loc=(0, -0.24, 1.20), bevel=0.01)  # Chest core
    # Helmet Head + Glowing T-Visor + Antenna
    add_box_part(bm, col, 0.34, 0.34, 0.28, 0x0f172a, loc=(0, -0.02, 1.56), bevel=0.04)
    add_box_part(bm, col, 0.30, 0.08, 0.09, 0x7dd3fc, loc=(0, -0.18, 1.57), bevel=0.01)
    add_box_part(bm, col, 0.04, 0.06, 0.24, 0x38bdf8, loc=(0.16, 0.04, 1.76), bevel=0.005)
    # Shoulder Pauldrons
    for sx in (-1, 1):
        add_box_part(bm, col, 0.28, 0.42, 0.26, 0x0369a1, loc=(sx * 0.50, 0, 1.32), rot=(0, -sx * 0.2, 0), bevel=0.03)
    # Right Arm (+X): Twin-Barrel Plasma Rifle
    add_box_part(bm, col, 0.18, 0.42, 0.18, 0x1e293b, loc=(0.52, -0.16, 1.02), bevel=0.02)
    add_cone_part(bm, col, 0.06, 0.05, 0.52, 0x38bdf8, loc=(0.52, -0.52, 1.02), rot=(math.pi / 2, 0, 0), segs=8)
    # Left Arm (-X): Massive Forward Hexagonal Energy Riot Shield!
    add_cone_part(bm, col, 0.56, 0.56, 0.08, 0x0ea5e9, loc=(-0.32, -0.44, 0.92), rot=(math.pi / 2, 0, 0), segs=6)
    add_cone_part(bm, col, 0.42, 0.42, 0.10, 0xa5f3fc, loc=(-0.32, -0.45, 0.92), rot=(math.pi / 2, 0, 0), segs=6)
    finalize_vcol_obj("Enemy_ShieldMech", bm, mat, loc=(0, 0, 0))

    # ---------------------------------------------------------------------
    # Type 3: Enemy_Juggernaut — Quad-Tread Twin-Cannon Dreadnought Mech
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    # 4 Armored Quad-Tread Legs
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box_part(bm, col, 0.34, 0.52, 0.28, 0x18181b, loc=(sx * 0.48, sy * 0.38, 0.14), bevel=0.03)
            add_box_part(bm, col, 0.24, 0.26, 0.42, 0x3f3f46, loc=(sx * 0.42, sy * 0.30, 0.44), bevel=0.02)
            add_box_part(bm, col, 0.36, 0.08, 0.12, 0xe11d48, loc=(sx * 0.48, sy * 0.62, 0.14), bevel=0.01)
    # Heavy Dreadnought Hull & Sloped Crimson Armor
    add_box_part(bm, col, 0.98, 0.96, 0.26, 0x27272a, loc=(0, 0, 0.68), bevel=0.04)
    add_box_part(bm, col, 1.12, 0.88, 0.56, 0x9f1239, loc=(0, 0.02, 1.08), bevel=0.06)
    add_box_part(bm, col, 0.52, 0.14, 0.28, 0xff1e42, loc=(0, -0.44, 1.06), bevel=0.02)  # Glowing furnace core
    # Armored Command Turret Head + Blazing Crimson Slit Visor
    add_box_part(bm, col, 0.48, 0.46, 0.28, 0x18181b, loc=(0, -0.08, 1.48), bevel=0.04)
    add_box_part(bm, col, 0.42, 0.10, 0.09, 0xfda4af, loc=(0, -0.30, 1.49), bevel=0.01)
    # Twin Over-Shoulder Heavy Siege Rail-Cannons!
    for sx in (-1, 1):
        add_box_part(bm, col, 0.30, 0.54, 0.30, 0x881337, loc=(sx * 0.48, 0.08, 1.54), bevel=0.03)
        add_cone_part(bm, col, 0.09, 0.07, 0.86, 0x334155, loc=(sx * 0.48, -0.52, 1.56), rot=(math.pi / 2, 0, 0), segs=10)
        add_cone_part(bm, col, 0.10, 0.10, 0.10, 0xfb7185, loc=(sx * 0.48, -0.94, 1.56), rot=(math.pi / 2, 0, 0), segs=10)
    finalize_vcol_obj("Enemy_Juggernaut", bm, mat, loc=(0, 0, 0))

    export_glb(os.path.join(OUT_DIR, "enemy_mechs.glb"))


# =========================================================================
# 2. Build Winged Cyber-Shogun Omega Boss Mech (boss_titan.glb)
# Hierarchical named nodes so torso, cannons & 6 energy wings animate live!
# =========================================================================
def build_boss_titan():
    clear_scene()
    m_dark = make_solid_mat("BossDarkSteel", 0x111827, metallic=0.82, roughness=0.28)
    m_armor = make_solid_mat("BossCrimsonArmor", 0x9f1239, metallic=0.72, roughness=0.26, emission_hex=0x881337, emission_strength=0.25)
    m_gold = make_solid_mat("BossGoldTrim", 0xfbbf24, metallic=0.88, roughness=0.2, emission_hex=0xf59e0b, emission_strength=0.65)
    m_glow = make_solid_mat("BossCoreGlow", 0xfff1f2, metallic=0.1, roughness=0.15, emission_hex=0xf43f5e, emission_strength=2.8)

    root = bpy.data.objects.new("Boss_Root", None)
    bpy.context.scene.collection.objects.link(root)

    def part_obj(name, sx, sy, sz, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.04):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name + "_m")
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat)
        o = bpy.data.objects.new(name, mesh)
        o.parent = parent
        o.location = loc
        o.rotation_euler = rot
        bpy.context.scene.collection.objects.link(o)
        return o

    # Heavy Titan Legs & Pelvis
    legs = bpy.data.objects.new("Boss_Legs", None)
    legs.parent = root
    bpy.context.scene.collection.objects.link(legs)
    part_obj("Pelvis", 1.35, 0.85, 0.42, m_dark, legs, loc=(0, 0, 1.48))
    part_obj("PelvisSkirtF", 0.95, 0.18, 0.55, m_armor, legs, loc=(0, -0.46, 1.35), rot=(0.18, 0, 0))
    for sx in (-1, 1):
        part_obj(f"Foot_{sx}", 0.62, 0.92, 0.26, m_dark, legs, loc=(sx * 0.58, -0.08, 0.13))
        part_obj(f"ToeGold_{sx}", 0.46, 0.32, 0.22, m_gold, legs, loc=(sx * 0.58, -0.48, 0.12))
        part_obj(f"Shin_{sx}", 0.52, 0.58, 0.82, m_armor, legs, loc=(sx * 0.58, 0.0, 0.65))
        part_obj(f"KneeCrest_{sx}", 0.32, 0.22, 0.42, m_gold, legs, loc=(sx * 0.58, -0.34, 0.95), rot=(-0.2, 0, 0))
        part_obj(f"Thigh_{sx}", 0.48, 0.52, 0.62, m_dark, legs, loc=(sx * 0.54, 0.0, 1.22))

    # Articulated Upper Torso
    torso = bpy.data.objects.new("Boss_Torso", None)
    torso.parent = root
    torso.location = (0, 0, 1.72)
    bpy.context.scene.collection.objects.link(torso)
    part_obj("ChestBlock", 1.72, 1.08, 1.05, m_armor, torso, loc=(0, 0, 0.58), bevel=0.08)
    part_obj("ChestCore", 0.62, 0.22, 0.52, m_glow, torso, loc=(0, -0.52, 0.62))
    part_obj("CollarGold", 1.10, 0.72, 0.22, m_gold, torso, loc=(0, -0.04, 1.14))

    # Horned Samurai-Gundam Head
    part_obj("HeadHelm", 0.64, 0.66, 0.56, m_dark, torso, loc=(0, -0.05, 1.48), bevel=0.05)
    part_obj("HeadVisor", 0.56, 0.14, 0.16, m_glow, torso, loc=(0, -0.36, 1.48), bevel=0.01)
    for sx in (-1, 1):
        part_obj(f"VFin_{sx}", 0.68, 0.10, 0.14, m_gold, torso, loc=(sx * 0.42, -0.34, 1.78), rot=(0, -sx * 0.48, 0), bevel=0.01)

    # Massive WingedPauldrons + Right Buster Railgun + Left Plasma Greatsword
    for sx in (-1, 1):
        part_obj(f"Pauldron_{sx}", 0.78, 0.96, 0.62, m_armor, torso, loc=(sx * 1.18, 0, 0.88), rot=(0, -sx * 0.28, 0), bevel=0.05)
        part_obj(f"PauldronTrim_{sx}", 0.84, 0.22, 0.18, m_gold, torso, loc=(sx * 1.24, -0.36, 1.08), rot=(0, -sx * 0.28, 0))

    # Right Arm (+X) Twin Heavy Buster Cannon
    r_arm = bpy.data.objects.new("Boss_RightArm", None)
    r_arm.parent = torso
    r_arm.location = (1.28, -0.1, 0.52)
    bpy.context.scene.collection.objects.link(r_arm)
    part_obj("RArmFore", 0.42, 0.86, 0.42, m_dark, r_arm, loc=(0, -0.32, -0.15))
    part_obj("RBusterBarrel1", 0.20, 1.65, 0.20, m_gold, r_arm, loc=(-0.12, -1.15, -0.10))
    part_obj("RBusterBarrel2", 0.20, 1.65, 0.20, m_gold, r_arm, loc=(0.12, -1.15, -0.10))
    part_obj("RBusterMuzzle", 0.50, 0.20, 0.28, m_glow, r_arm, loc=(0, -1.95, -0.10))

    # Left Arm (-X) Giant Crimson Plasma Greatsword
    l_arm = bpy.data.objects.new("Boss_LeftArm", None)
    l_arm.parent = torso
    l_arm.location = (-1.28, -0.1, 0.52)
    bpy.context.scene.collection.objects.link(l_arm)
    part_obj("LArmFore", 0.42, 0.78, 0.42, m_dark, l_arm, loc=(0, -0.28, -0.15))
    part_obj("SwordHilt", 0.48, 0.24, 0.24, m_gold, l_arm, loc=(0, -0.76, -0.12))
    part_obj("SwordBlade", 0.14, 2.25, 0.42, m_glow, l_arm, loc=(0, -1.92, -0.12), bevel=0.02)

    # 6-Wing Seraphim Booster Pack
    wings = bpy.data.objects.new("Boss_Wings", None)
    wings.parent = torso
    wings.location = (0, 0.58, 0.78)
    bpy.context.scene.collection.objects.link(wings)
    part_obj("WingHub", 0.72, 0.44, 0.68, m_dark, wings, loc=(0, 0.1, 0))
    for sx in (-1, 1):
        for wi, ang in enumerate((0.52, 0.05, -0.42)):
            part_obj(
                f"WingBinder_{sx}_{wi}",
                1.65,
                0.12,
                0.32,
                m_gold if wi == 0 else m_glow,
                wings,
                loc=(sx * (1.05 + wi * 0.12), 0.22, 0.45 - wi * 0.42),
                rot=(0.15, -sx * ang, sx * 0.22),
                bevel=0.02,
            )

    export_glb(os.path.join(OUT_DIR, "boss_titan.glb"))


# =========================================================================
# 3. Build Custom Mecha Upgrade Armor & Weapons Pack for the 3 Player Mechs!
# Mounted onto RobotExpressive's Torso / Head / Hands so each of the 3 mechs
# transforms into a distinct Gundam / Heavy Armored Core / Funnel Mech!
# =========================================================================
def build_player_mech_kits():
    clear_scene()
    m_cyan = make_solid_mat("KitCyanGlow", 0x22d3ee, metallic=0.2, roughness=0.2, emission_hex=0x22d3ee, emission_strength=2.2)
    m_red = make_solid_mat("KitCrimsonArmor", 0xe11d48, metallic=0.75, roughness=0.25, emission_hex=0xf43f5e, emission_strength=0.9)
    m_violet = make_solid_mat("KitVioletGlow", 0xa855f7, metallic=0.3, roughness=0.2, emission_hex=0xc084fc, emission_strength=2.0)
    m_steel = make_solid_mat("KitDarkSteel", 0x0f172a, metallic=0.85, roughness=0.28)
    m_gold = make_solid_mat("KitGold", 0xfbbf24, metallic=0.88, roughness=0.2, emission_hex=0xfbbf24, emission_strength=1.1)

    def box_to(name, sx, sy, sz, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0)):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.02, segments=1, affect='EDGES')
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name + "_m")
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat)
        o = bpy.data.objects.new(name, mesh)
        o.parent = parent
        o.location = loc
        o.rotation_euler = rot
        bpy.context.scene.collection.objects.link(o)

    # Kit 1: STRIKER-0 — Swept Cyber Wing Pack + V-Fin Crest
    k1 = bpy.data.objects.new("Kit_Striker", None)
    bpy.context.scene.collection.objects.link(k1)
    box_to("S_Pack", 0.55, 0.35, 0.62, m_steel, k1, loc=(0, 0.32, 0))
    for sx in (-1, 1):
        box_to(f"S_WingU_{sx}", 1.15, 0.08, 0.26, m_cyan, k1, loc=(sx * 0.72, 0.42, 0.28), rot=(0.2, -sx * 0.42, sx * 0.25))
        box_to(f"S_WingL_{sx}", 0.85, 0.08, 0.18, m_gold, k1, loc=(sx * 0.58, 0.40, -0.18), rot=(0.2, sx * 0.32, sx * 0.15))

    # Kit 2: AEGIS-IV — Twin 6-Tube Heavy Shoulder Missile Pods
    k2 = bpy.data.objects.new("Kit_Aegis", None)
    bpy.context.scene.collection.objects.link(k2)
    box_to("A_Pack", 0.78, 0.46, 0.68, m_steel, k2, loc=(0, 0.34, 0.05))
    for sx in (-1, 1):
        box_to(f"A_Pod_{sx}", 0.48, 0.56, 0.48, m_red, k2, loc=(sx * 0.66, 0.12, 0.46))
        box_to(f"A_Warheads_{sx}", 0.38, 0.10, 0.38, m_gold, k2, loc=(sx * 0.66, -0.16, 0.46))

    # Kit 3: NEXUS-9 — 4 Floating Fin-Funnel Dragoon Halo Binders
    k3 = bpy.data.objects.new("Kit_Nexus", None)
    bpy.context.scene.collection.objects.link(k3)
    for sx in (-1, 1):
        for sy_idx, z_off in enumerate((0.48, -0.24)):
            box_to(
                f"N_Funnel_{sx}_{sy_idx}",
                0.18,
                0.16,
                1.05,
                m_violet if sy_idx == 0 else m_gold,
                k3,
                loc=(sx * 0.88, 0.42, z_off),
                rot=(0.18, sx * (0.45 if sy_idx == 0 else -0.45), 0),
            )

    export_glb(os.path.join(OUT_DIR, "mech_armory.glb"))


if __name__ == "__main__":
    build_enemy_mechs()
    build_boss_titan()
    build_player_mech_kits()
    print("=== ALL CYBER SURVIVORS 3D MECH GLBS EXPORTED ===")
