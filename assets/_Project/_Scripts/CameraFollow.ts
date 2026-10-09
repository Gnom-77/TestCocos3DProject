import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/*
Камера от третьего лица.
*/
@ccclass('CameraFollow')
export class CameraFollow extends Component {
    @property({ type: Node, tooltip: 'CameraPivot' })
    pivot: Node = null!;

    @property({ tooltip: 'Смещение камеры' })
    offset = new Vec3(0, 0, 4);

    @property({ tooltip: 'Сглаживание движения за игроком' })
    smooth = 15;

    private smoothPos = new Vec3();
    private camOffset = new Vec3();
    private inited = false;

    lateUpdate(dt: number) {
        if (!this.pivot) return;

        const rot = this.pivot.worldRotation;
        const pos = this.pivot.worldPosition;

        if (!this.inited || this.smooth <= 0) {
            this.smoothPos.set(pos);
            this.inited = true;
        } else {
            Vec3.lerp(this.smoothPos, this.smoothPos, pos, Math.min(1, dt * this.smooth));
        }

        Vec3.transformQuat(this.camOffset, this.offset, rot);

        this.node.setWorldPosition(
            this.smoothPos.x + this.camOffset.x,
            this.smoothPos.y + this.camOffset.y,
            this.smoothPos.z + this.camOffset.z,
        );
        this.node.setWorldRotation(rot);
    }
}