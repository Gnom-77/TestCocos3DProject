import {
    _decorator, Component, Node, Prefab, instantiate, NodePool, Vec3, Quat,
    PhysicsSystem, geometry, input, Input, EventMouse, ParticleSystem,
} from 'cc';
import { PlayerController, isUnder } from './PlayerController';
const { ccclass, property } = _decorator;

/** Одна летящая капля. Позиция считается формулой: p = start + v0·t + g·t²/2 */
class Droplet {
    node: Node;
    start = new Vec3();
    v0 = new Vec3();
    pos = new Vec3();   // позиция на прошлом кадре (для рейкаста)
    vel = new Vec3();   // текущая скорость (для поворота/растяжения)
    life = 0;
    constructor(node: Node) { this.node = node; }
}

@ccclass('HoseSprayer')
export class HoseSprayer extends Component {
    @property({ type: Node, tooltip: 'Сопло шланга' })
    muzzle: Node = null!;

    @property({ type: Prefab, tooltip: 'Префаб капли' })
    dropletPrefab: Prefab = null!;

    @property({ type: Prefab, tooltip: 'Префаб брызг' })
    splashPrefab: Prefab = null!;

    @property({ tooltip: 'Капель в секунду' })
    fireRate = 60;

    @property({ tooltip: 'Базовая скорость капли' })
    speed = 14;

    @property
    autoSpeed = true;

    @property
    maxSpeed = 40;

    @property({ tooltip: 'Разброс направления' })
    spread = 0.01;

    @property({ tooltip: 'Случайный разброс скорости, доля (0.01 = ±1%)' })
    speedJitter = 0.01;

    @property({ tooltip: 'Гравитация (отрицательное число)' })
    gravity = -9.8;

    @property({ tooltip: 'Максимальное время жизни капли, сек' })
    maxLife = 3;

    @property({ tooltip: 'Лететь по дуге точно в курсор. Выкл: направление прямо на курсор' })
    ballistic = true;

    @property({ tooltip: 'Маска слоёв для попаданий' })
    hitMask = 0xffffffff;

    @property
    useGroundPlane = true;

    @property
    dropletScale = 0.15;

    @property
    stretch = 2.5;

    @property({ tooltip: 'Минимальный интервал между брызгами, сек' })
    splashCooldown = 0.06;

    @property
    splashLifetime = 1;

    private player: PlayerController | null = null;
    private firing = false;
    private acc = 0;

    private active: Droplet[] = [];
    private dropPool = new NodePool();
    private splashPool = new NodePool();

    private ray = new geometry.Ray();
    private launchDir = new Vec3();
    private aimDelta = new Vec3();
    private nextPos = new Vec3();
    private segDir = new Vec3();
    private hitPt = new Vec3();
    private lookTarget = new Vec3();
    private qTmp = new Quat();
    private lastSplashTime = 0;

    onLoad() {
        this.player = this.getComponent(PlayerController);
        if (!this.player) {
            console.warn('[HoseSprayer] PlayerController не найден на этой ноде');
        }
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    onDestroy() {
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        this.dropPool.clear();
        this.splashPool.clear();
    }

    onDisable() {
        this.firing = false;
        for (let i = this.active.length - 1; i >= 0; i--) {
            this.recycle(this.active[i], i);
        }
    }

    private onMouseDown(e: EventMouse) { if (e.getButton() === 0) this.firing = true; }
    private onMouseUp(e: EventMouse)   { if (e.getButton() === 0) this.firing = false; }

    update(dt: number) {
        if (this.firing) {
            this.acc += dt;
            const interval = 1 / this.fireRate;
            while (this.acc >= interval) {
                this.acc -= interval;
                this.spawnDroplet();
            }
        } else {
            this.acc = 0;
        }
        this.updateDroplets(dt);
    }

    private spawnDroplet() {
        const origin = this.muzzle.worldPosition;
        const dir = this.launchDir;
        let v = this.speed;

        if (this.player && this.player.hasAim) {
            v = this.computeLaunch(origin, this.player.aimPoint, dir);
        } else {
            dir.set(this.muzzle.forward);
        }

        // Небольшой разброс направления и скорости
        dir.x += (Math.random() - 0.5) * this.spread * 2;
        dir.y += (Math.random() - 0.5) * this.spread * 2;
        dir.z += (Math.random() - 0.5) * this.spread * 2;
        dir.normalize();
        v *= 1 + (Math.random() * 2 - 1) * this.speedJitter;

        const node = this.dropPool.size() > 0
            ? this.dropPool.get()!
            : instantiate(this.dropletPrefab);
        node.setParent(this.node.scene!);
        node.setWorldPosition(origin);
        node.setScale(this.dropletScale, this.dropletScale, this.dropletScale);

        const d = new Droplet(node);
        d.start.set(origin);
        d.pos.set(origin);
        Vec3.multiplyScalar(d.v0, dir, v);
        d.vel.set(d.v0);
        this.active.push(d);
    }

    private computeLaunch(origin: Vec3, target: Vec3, out: Vec3): number {
        const delta = Vec3.subtract(this.aimDelta, target, origin);
        const hx = delta.x;
        const hz = delta.z;
        const d = Math.sqrt(hx * hx + hz * hz);
        const dy = delta.y;
        const g = Math.abs(this.gravity);

        if (!this.ballistic || g < 0.001) {
            if (delta.lengthSqr() < 1e-6) out.set(this.muzzle.forward);
            else out.set(delta).normalize();
            return this.speed;
        }

        if (d < 0.05) {
            out.set(this.muzzle.forward);
            return this.speed;
        }

        let v = this.speed;

        if (this.autoSpeed) {
            const vMin = Math.sqrt(g * (dy + Math.sqrt(dy * dy + d * d)));
            v = Math.min(this.maxSpeed, Math.max(this.speed, vMin * 1.02));
        }

        const v2 = v * v;
        const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
        const tanTheta = disc >= 0
            ? (v2 - Math.sqrt(disc)) / (g * d)
            : 1; // цель за пределом дальности: 45° = максимум

        const cosT = 1 / Math.sqrt(1 + tanTheta * tanTheta);
        const sinT = tanTheta * cosT;
        out.set((hx / d) * cosT, sinT, (hz / d) * cosT);
        return v;
    }

    private updateDroplets(dt: number) {
        const physics = PhysicsSystem.instance;
        const groundY = this.player ? this.player.groundY : 0;

        for (let i = this.active.length - 1; i >= 0; i--) {
            const d = this.active[i];
            d.life += dt;
            const t = d.life;

            this.nextPos.set(
                d.start.x + d.v0.x * t,
                d.start.y + d.v0.y * t + 0.5 * this.gravity * t * t,
                d.start.z + d.v0.z * t,
            );
            d.vel.set(d.v0.x, d.v0.y + this.gravity * t, d.v0.z);

            const seg = Vec3.subtract(this.segDir, this.nextPos, d.pos);
            const len = seg.length();
            let hit = false;

            if (len > 0.0001) {
                seg.multiplyScalar(1 / len);
                this.ray.o.set(d.pos);
                this.ray.d.set(seg);

                if (physics.raycastClosest(this.ray, this.hitMask, len, false)) {
                    const r = physics.raycastClosestResult;
                    if (!isUnder(r.collider.node, this.node)) {
                        this.onHit(r.hitPoint, r.hitNormal, r.collider.node);
                        hit = true;
                    }
                }
            }

            if (!hit && this.useGroundPlane && this.nextPos.y <= groundY && d.vel.y < 0) {
                const drop = d.pos.y - this.nextPos.y;
                const k = drop > 1e-5 ? Math.min(1, Math.max(0, (d.pos.y - groundY) / drop)) : 1;
                Vec3.lerp(this.hitPt, d.pos, this.nextPos, k);
                this.hitPt.y = groundY;
                this.onHit(this.hitPt, Vec3.UP, null);
                hit = true;
            }

            if (hit || d.life > this.maxLife) {
                this.recycle(d, i);
                continue;
            }

            d.pos.set(this.nextPos);
            d.node.setWorldPosition(d.pos);

            if (this.stretch > 1.001) {
                Vec3.add(this.lookTarget, d.pos, d.vel);
                d.node.lookAt(this.lookTarget);
                const s = this.dropletScale;
                d.node.setScale(s, s, s * this.stretch);
            }
        }
    }

    private onHit(point: Vec3, normal: Vec3, target: Node | null) {
        const now = performance.now() / 1000;
        if (now - this.lastSplashTime >= this.splashCooldown) {
            this.lastSplashTime = now;
            this.playSplash(point, normal);
        }

    }

    private playSplash(point: Vec3, normal: Vec3) {
        const s = this.splashPool.size() > 0
            ? this.splashPool.get()!
            : instantiate(this.splashPrefab);

        s.setParent(this.node.scene!);

        s.setWorldPosition(
            point.x + normal.x * 0.02,
            point.y + normal.y * 0.02,
            point.z + normal.z * 0.02,
        );

        Quat.rotationTo(this.qTmp, Vec3.UP, normal);
        s.setWorldRotation(this.qTmp);

        const k = 0.7 + Math.random() * 0.5;
        s.setScale(k, k, k);

        for (const ps of s.getComponentsInChildren(ParticleSystem)) {
            ps.clear();
            ps.play();
        }

        this.scheduleOnce(() => {
            if (!s.isValid) return;
            for (const ps of s.getComponentsInChildren(ParticleSystem)) ps.stop();
            this.splashPool.put(s);
        }, this.splashLifetime);
    }

    private recycle(d: Droplet, index: number) {
        this.active.splice(index, 1);
        this.dropPool.put(d.node);
    }
}