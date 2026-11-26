import SwiftUI
import RealityKit
import ARKit
import UIKit
import simd

// One shared view is used by the full iOS host app AND its App Clip.
// The customer's controls stay visible directly over the native camera feed.
@main
struct LUXDigitalSamplesApp: App {
    var body: some Scene {
        WindowGroup {
            LUXARScreen()
        }
    }
}

struct LUXARScreen: View {
    @StateObject private var ar = LUXARController()

    var body: some View {
        ZStack {
            LUXARCamera(controller: ar)
                .ignoresSafeArea()
            VStack(spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("LUX").font(.system(size: 27, weight: .ultraLight, design: .rounded))
                        Text("WEST COAST NATURALS")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(2)
                    }
                    Spacer()
                    Text(ar.placed ? "AR PLACED" : "FIND A WALL")
                        .font(.caption2.bold())
                        .padding(9)
                        .background(.ultraThinMaterial, in: Capsule())
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)

                Text(ar.status)
                    .font(.system(size: 12, weight: .medium))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 11)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 17)

                Spacer()

                if ar.placed {
                    // Native SwiftUI buttons directly control geometry in the open AR scene.
                    HStack(spacing: 12) {
                        edgePair("LEFT", edge: .left)
                        edgePair("RIGHT", edge: .right)
                    }
                    HStack(spacing: 12) {
                        edgePair("UP", edge: .top)
                        edgePair("DOWN", edge: .bottom)
                    }
                    HStack(spacing: 10) {
                        Text(ar.sizeLabel)
                            .font(.system(size: 11, weight: .medium))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                        Spacer()
                        Button("RESET SIZE") { ar.resetSize() }
                            .font(.caption2.bold())
                            .buttonStyle(.bordered)
                            .tint(.white)
                        Button("REPLACE") { ar.remove() }
                            .font(.caption2.bold())
                            .buttonStyle(.bordered)
                            .tint(.white)
                    }.padding(.top, 4)
                } else {
                    Button {
                        ar.placeOnWall()
                    } label: {
                        Text("PLACE SAMPLE ON WALL")
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .font(.system(size: 13, weight: .bold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 0.78, green: 0.1, blue: 0.17))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 23)
        }
        .preferredColorScheme(.dark)
    }

    private func edgePair(_ title: String, edge: SampleEdge) -> some View {
        HStack(spacing: 5) {
            Text(title).font(.system(size: 11, weight: .bold)).frame(width: 48, alignment: .leading)
            Button("−") { ar.resize(edge, inward: true) }
                .accessibilityLabel("Reveal less " + title.lowercased())
            Button("+") { ar.resize(edge, inward: false) }
                .accessibilityLabel("Reveal more " + title.lowercased())
        }
        .buttonStyle(.borderedProminent)
        .tint(Color(red: 0.18, green: 0.23, blue: 0.2))
        .controlSize(.large)
        .frame(maxWidth: .infinity)
    }
}

struct LUXARCamera: UIViewRepresentable {
    @ObservedObject var controller: LUXARController

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        controller.attach(view)
        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {}
}

enum SampleEdge: String, CaseIterable {
    case left, right, top, bottom
}

struct SampleBounds {
    var left: Float = -0.8
    var right: Float = 0.8
    var bottom: Float = -0.55
    var top: Float = 0.55

    // Preserve source dimensions. NEVER change the model's scale.
    mutating func change(_ edge: SampleEdge, inward: Bool) {
        let step: Float = inward ? -0.25 : 0.25
        switch edge {
        case .left: left = min(right - 0.35, max(-4.5, left - step))
        case .right: right = max(left + 0.35, min(4.5, right + step))
        case .top: top = max(bottom + 0.35, min(2.4, top + step))
        case .bottom: bottom = min(top - 0.35, max(-2.4, bottom - step))
        }
    }
}

// This struct is NOT a new model segment. It is a temporary vertex generated
// when a triangle of the ORIGINAL model crosses the selected reveal boundary.
private struct CropVertex {
    var position: SIMD3<Float>
    var uv: SIMD2<Float>
}

private struct LUXSourceMesh: Decodable {
    let positions: [[Float]]
    let uv: [[Float]]
    let triangles: [[Int]]
}

@MainActor
final class LUXARController: ObservableObject {
    @Published private(set) var placed = false
    @Published private(set) var status = "Move slowly toward a textured wall, then tap PLACE."
    @Published private(set) var sizeLabel = "1.60 × 1.10 m"

    private weak var view: ARView?
    private var sampleAnchor: AnchorEntity?
    private var product: ModelEntity?
    private var trims: [SampleEdge: ModelEntity] = [:]
    private var handles: [SampleEdge: ModelEntity] = [:]
    private var source: LUXSourceMesh?
    private var textureMaterial: UnlitMaterial?
    private var bounds = SampleBounds()

    func attach(_ arView: ARView) {
        view = arView
        guard ARWorldTrackingConfiguration.isSupported else {
            status = "This iPhone does not support ARKit world tracking."
            return
        }
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.vertical]
        arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
        let tap = UITapGestureRecognizer(target: self, action: #selector(onModelTap(_:)))
        arView.addGestureRecognizer(tap)
        do {
            guard let url = Bundle.main.url(forResource: "lap-mesh", withExtension: "json") else {
                status = "LUX mesh asset is missing from the App Clip bundle."
                return
            }
            source = try JSONDecoder().decode(LUXSourceMesh.self, from: Data(contentsOf: url))
            let tex = try TextureResource.load(named: "heartwood.jpg")
            textureMaterial = UnlitMaterial(texture: tex)
            status = "Full LUX profile loaded. Aim at a wall and tap PLACE."
        } catch {
            status = "Could not load LUX geometry: \(error.localizedDescription)"
        }
    }

    func placeOnWall() {
        guard source != nil, let arView = view else { return }
        let point = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
        let results = arView.raycast(from: point, allowing: .existingPlaneGeometry, alignment: .vertical)
        let hits = results.isEmpty
            ? arView.raycast(from: point, allowing: .estimatedPlane, alignment: .vertical)
            : results
        guard let hit = hits.first, let camera = arView.session.currentFrame?.camera else {
            status = "No vertical wall found yet. Move sideways slowly and try again."
            return
        }

        let p = hit.worldTransform.columns.3
        let c = camera.transform.columns.3
        // Keep X horizontal, Y vertical, and the model facing the user's camera.
        let yaw = atan2(c.x-p.x, c.z-p.z)
        let anchor = AnchorEntity(world: hit.worldTransform)
        anchor.orientation = simd_quatf(angle: yaw, axis: SIMD3<Float>(0,1,0))
        arView.scene.addAnchor(anchor)
        sampleAnchor = anchor
        placed = true
        renderSourceCrop()
        status = "Native ARKit anchor placed. Tap the buttons or white 3D edge handles."
    }

    func resize(_ edge: SampleEdge, inward: Bool) {
        guard placed else { return }
        bounds.change(edge, inward: inward)
        renderSourceCrop()
    }

    func resetSize() {
        bounds = SampleBounds()
        if placed { renderSourceCrop() }
    }

    func remove() {
        sampleAnchor?.removeFromParent()
        sampleAnchor = nil
        product = nil
        trims.removeAll()
        handles.removeAll()
        placed = false
        status = "Move slowly to find a vertical wall and place the sample again."
    }

    @objc private func onModelTap(_ gesture: UITapGestureRecognizer) {
        guard let arView = view, placed,
              let hitEntity = arView.entity(at: gesture.location(in: arView)) else { return }
        var e: Entity? = hitEntity
        while let current = e {
            if current.name.hasPrefix("lux-handle-"),
               let side = SampleEdge(rawValue: current.name.replacingOccurrences(of: "lux-handle-", with: "")) {
                resize(side, inward: false)
                return
            }
            e = current.parent
        }
    }

    private func renderSourceCrop() {
        guard let anchor = sampleAnchor, let source, let textureMaterial else { return }
        do {
            let mesh = try cropMesh(source, to: bounds)
            product?.removeFromParent()
            let model = ModelEntity(mesh: mesh, materials: [textureMaterial])
            model.name = "Original LUX profile, cropped; never scaled"
            anchor.addChild(model)
            product = model
            updateEdges(anchor)
            sizeLabel = String(format: "%.2f × %.2f m", bounds.right-bounds.left, bounds.top-bounds.bottom)
        } catch {
            status = "Mesh update failed: \(error.localizedDescription)"
        }
    }

    private func updateEdges(_ anchor: AnchorEntity) {
        let thickness: Float = 0.0254
        let w = bounds.right - bounds.left
        let h = bounds.top - bounds.bottom
        let cx = (bounds.left+bounds.right)/2
        let cy = (bounds.bottom+bounds.top)/2
        let trimColor = UIColor(red: 0.37, green: 0.24, blue: 0.17, alpha: 1)
        for side in SampleEdge.allCases {
            let edgeSize: SIMD3<Float>
            let edgePosition: SIMD3<Float>
            let handlePosition: SIMD3<Float>
            switch side {
            case .left:
                edgeSize = SIMD3(thickness,h,0.024)
                edgePosition = SIMD3(bounds.left+thickness/2,cy,0.035)
                handlePosition = SIMD3(bounds.left-0.10,cy,0.08)
            case .right:
                edgeSize = SIMD3(thickness,h,0.024)
                edgePosition = SIMD3(bounds.right-thickness/2,cy,0.035)
                handlePosition = SIMD3(bounds.right+0.10,cy,0.08)
            case .top:
                edgeSize = SIMD3(w,thickness,0.024)
                edgePosition = SIMD3(cx,bounds.top-thickness/2,0.035)
                handlePosition = SIMD3(cx,bounds.top+0.10,0.08)
            case .bottom:
                edgeSize = SIMD3(w,thickness,0.024)
                edgePosition = SIMD3(cx,bounds.bottom+thickness/2,0.035)
                handlePosition = SIMD3(cx,bounds.bottom-0.10,0.08)
            }
            if let old = trims[side] { old.removeFromParent() }
            let trim = ModelEntity(
                mesh: .generateBox(size: edgeSize),
                materials: [SimpleMaterial(color: trimColor, isMetallic: false)])
            trim.position = edgePosition
            anchor.addChild(trim)
            trims[side] = trim

            let handle: ModelEntity
            if let existing = handles[side] {
                handle = existing
            } else {
                handle = ModelEntity(
                    mesh: .generateBox(size: SIMD3<Float>(0.16,0.11,0.035)),
                    materials: [SimpleMaterial(color: .white, isMetallic: false)])
                handle.name = "lux-handle-" + side.rawValue
                handle.generateCollisionShapes(recursive: false)
                anchor.addChild(handle)
                handles[side] = handle
            }
            handle.position = handlePosition
        }
    }

    // Crop the real GLB triangles at four independently adjustable positions.
    // All UVs are INTERPOLATED; no tiling, scales, matte objects or extra strips.
    private func cropMesh(_ original: LUXSourceMesh, to rect: SampleBounds) throws -> MeshResource {
        var points: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var texcoords: [SIMD2<Float>] = []
        var indices: [UInt32] = []

        for t in original.triangles {
            guard t.count == 3 else { continue }
            var polygon: [CropVertex] = t.map { i in
                CropVertex(position: SIMD3<Float>(original.positions[i][0],
                                                    original.positions[i][1],
                                                    original.positions[i][2]),
                           uv: SIMD2<Float>(original.uv[i][0], original.uv[i][1]))
            }
            polygon = clip(polygon, axis: 0, limit: rect.left, greater: true)
            polygon = clip(polygon, axis: 0, limit: rect.right, greater: false)
            polygon = clip(polygon, axis: 1, limit: rect.bottom, greater: true)
            polygon = clip(polygon, axis: 1, limit: rect.top, greater: false)

            guard polygon.count >= 3 else { continue }
            for k in 1..<(polygon.count - 1) {
                let tri = [polygon[0], polygon[k], polygon[k+1]]
                let a = tri[0].position
                let b = tri[1].position
                let c = tri[2].position
                let cross = simd_cross(b-a, c-a)
                guard simd_length_squared(cross) > 1e-12 else { continue }
                let normal = simd_normalize(cross)
                // Render both sides; surface visibility no longer depends on winding.
                for order in [[0,1,2],[2,1,0]] {
                    for i in order {
                        points.append(tri[i].position)
                        texcoords.append(tri[i].uv)
                        normals.append(order[0] == 0 ? normal : -normal)
                        indices.append(UInt32(indices.count))
                    }
                }
            }
        }
        var d = MeshDescriptor(name: "Original UV-preserved LUX crop")
        d.positions = MeshBuffer(points)
        d.normals = MeshBuffer(normals)
        d.textureCoordinates = MeshBuffer(texcoords)
        d.primitives = .triangles(indices)
        return try MeshResource.generate(from: [d])
    }

    private func clip(_ poly: [CropVertex], axis: Int, limit: Float, greater: Bool) -> [CropVertex] {
        guard let last = poly.last else { return [] }
        var previous = last
        var result: [CropVertex] = []
        func coord(_ v: CropVertex) -> Float { axis == 0 ? v.position.x : v.position.y }
        func inside(_ v: CropVertex) -> Bool {
            greater ? coord(v) >= limit : coord(v) <= limit
        }
        for current in poly {
            let a = inside(previous), b = inside(current)
            if a != b {
                let denominator = coord(current)-coord(previous)
                let t = abs(denominator) < 1e-10 ? Float(0) : max(0,min(1,(limit-coord(previous))/denominator))
                result.append(CropVertex(position: simd_mix(previous.position,current.position,SIMD3<Float>(repeating:t)),
                                         uv: simd_mix(previous.uv,current.uv,SIMD2<Float>(repeating:t))))
            }
            if b { result.append(current) }
            previous = current
        }
        return result
    }
}
