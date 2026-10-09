import { _decorator, Component, Node, Vec3, Camera, input, Input,
         EventKeyboard, EventMouse, KeyCode, geometry, PhysicsSystem, game, sys } from 'cc';
const { ccclass, property } = _decorator;

export function isUnder(node: Node | null, root: Node): boolean {
    while (node) {
        if (node === root) return true;
        node = node.parent;
    }
    return false;
}


@ccclass('PlayerController')
export class PlayerController extends Component {
    @property(Camera) camera: Camera = null!;

    @property
    cameraPivot: Node = null!;

    @property moveSpeed = 5;

    @property({ tooltip: 'Чувствительность мыши, градусов на пиксель' })
    sensitivity = 0.15;

    @property({ tooltip: 'Инвертировать вертикальную ось мыши' })
    invertY = false;

    @property minPitch = -60;
    @property maxPitch = 45;

    @property({ tooltip: 'Дальность прицела' })
    maxAimDistance = 100;

    @property
    groundY = 0;

    @property({ tooltip: 'Маска слоёв для прицеливания' })
    aimMask = 0xffffffff;

    @property({ type: Node, tooltip: 'Сфера для отладки прицела' })
    aimMarker: Node | null = null;

    public aimPoint = new Vec3();
    public hasAim = false;

    private keys = new Set<number>();
    private yaw = 0;
    private pitch = 0;

    private groundPlane = geometry.Plane.create(0, 1, 0, 0);
    private ray = new geometry.Ray();
    private moveDir = new Vec3();

    onLoad() {
        this.yaw = this.node.eulerAngles.y;
        if (this.cameraPivot) this.pitch = this.cameraPivot.eulerAngles.x;

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    }

    private onKeyDown(e: EventKeyboard) { this.keys.add(e.keyCode); }
    private onKeyUp(e: EventKeyboard) { this.keys.delete(e.keyCode); }

    private isLocked(): boolean {
        if (!sys.isBrowser) return true;
        return document.pointerLockElement === (game.canvas as HTMLCanvasElement | null);
    }

    private onMouseDown(_e: EventMouse) {
        if (sys.isBrowser && !this.isLocked()) {
            (game.canvas as HTMLCanvasElement | null)?.requestPointerLock();
        }
    }

    private onMouseMove(e: EventMouse) {
        if (!this.isLocked()) return;

        const ev = e as any;
        let dx: number;
        let dy: number;
        if (typeof ev.movementX === 'number') {
            dx = ev.movementX;
            dy = -ev.movementY;          
        } else {
            dx = e.getDeltaX();
            dy = e.getDeltaY();
        }
        if (this.invertY) dy = -dy;

        this.yaw -= dx * this.sensitivity;
        this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch + dy * this.sensitivity));
    }

    update(dt: number) {
        this.applyLook();
        this.move(dt);
        this.updateAim();
    }

    private applyLook() {
        this.node.setRotationFromEuler(0, this.yaw, 0);
        if (this.cameraPivot) this.cameraPivot.setRotationFromEuler(this.pitch, 0, 0);
    }

    private move(dt: number) {
        const dir = this.moveDir.set(0, 0, 0);
        if (this.keys.has(KeyCode.KEY_W)) dir.z -= 1;
        if (this.keys.has(KeyCode.KEY_S)) dir.z += 1;
        if (this.keys.has(KeyCode.KEY_A)) dir.x -= 1;
        if (this.keys.has(KeyCode.KEY_D)) dir.x += 1;

        if (dir.lengthSqr() > 0) {
            dir.normalize().multiplyScalar(this.moveSpeed * dt);
            Vec3.transformQuat(dir, dir, this.node.worldRotation);
            this.node.translate(dir, Node.NodeSpace.WORLD);
        }
    }

    private updateAim() {
        if (!this.camera) return;

        const camNode = this.camera.node;
        const origin = camNode.worldPosition;
        const fwd = camNode.forward;
        this.ray.o.set(origin);
        this.ray.d.set(fwd);

        let found = false;

        const physics = PhysicsSystem.instance;
        if (physics.raycast(this.ray, this.aimMask, this.maxAimDistance, false)) {
            let best = Infinity;
            for (const r of physics.raycastResults) {
                if (r.distance < best && !isUnder(r.collider.node, this.node)) {
                    best = r.distance;
                    this.aimPoint.set(r.hitPoint);
                    found = true;
                }
            }
        }

        if (!found) {
            this.groundPlane.d = this.groundY;
            const dist = geometry.intersect.rayPlane(this.ray, this.groundPlane);
            if (dist > 0 && dist < this.maxAimDistance) {
                this.ray.computeHit(this.aimPoint, dist);
                found = true;
            }
        }

        if (!found) {
            Vec3.scaleAndAdd(this.aimPoint, origin, fwd, this.maxAimDistance);
        }

        this.hasAim = true;
        if (this.aimMarker) this.aimMarker.setWorldPosition(this.aimPoint);
    }
}