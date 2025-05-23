import type { CCEncodingContext, CCParsingContext } from "@zwave-js/cc";
import {
	CommandClasses,
	type GetValueDB,
	type MaybeNotKnown,
	type MessageOrCCLogEntry,
	MessagePriority,
	type WithAddress,
	validatePayload,
} from "@zwave-js/core";
import { Bytes, getEnumMemberName, num2hex, pick } from "@zwave-js/shared";
import { validateArgs } from "@zwave-js/transformers";
import { CCAPI, PhysicalCCAPI } from "../lib/API.js";
import {
	type CCRaw,
	CommandClass,
	type InterviewContext,
} from "../lib/CommandClass.js";
import {
	API,
	CCCommand,
	ccValueProperty,
	ccValues,
	commandClass,
	expectedCCResponse,
	implementedVersion,
} from "../lib/CommandClassDecorators.js";
import { V } from "../lib/Values.js";
import {
	ZWavePlusCommand,
	ZWavePlusNodeType,
	ZWavePlusRoleType,
} from "../lib/_Types.js";

// SDS13782 The advertised Z-Wave Plus Version, Role Type and Node Type information values
// MUST be identical for the Root Device and all Multi Channel End Points
// --> We only access endpoint 0

export const ZWavePlusCCValues = V.defineCCValues(
	CommandClasses["Z-Wave Plus Info"],
	{
		...V.staticProperty("zwavePlusVersion", undefined, {
			supportsEndpoints: false,
			internal: true,
		}),
		...V.staticProperty("nodeType", undefined, {
			supportsEndpoints: false,
			internal: true,
		}),
		...V.staticProperty("roleType", undefined, {
			supportsEndpoints: false,
			internal: true,
		}),
		...V.staticProperty("userIcon", undefined, {
			internal: true,
		}),
		...V.staticProperty("installerIcon", undefined, {
			internal: true,
		}),
	},
);

// @noSetValueAPI This CC is read-only

@API(CommandClasses["Z-Wave Plus Info"])
export class ZWavePlusCCAPI extends PhysicalCCAPI {
	public supportsCommand(cmd: ZWavePlusCommand): MaybeNotKnown<boolean> {
		switch (cmd) {
			case ZWavePlusCommand.Get:
			case ZWavePlusCommand.Report:
				return true; // This is mandatory
		}
		return super.supportsCommand(cmd);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public async get() {
		this.assertSupportsCommand(ZWavePlusCommand, ZWavePlusCommand.Get);

		const cc = new ZWavePlusCCGet({
			nodeId: this.endpoint.nodeId,
			endpointIndex: this.endpoint.index,
		});
		const response = await this.host.sendCommand<ZWavePlusCCReport>(
			cc,
			this.commandOptions,
		);
		if (response) {
			return pick(response, [
				"zwavePlusVersion",
				"nodeType",
				"roleType",
				"installerIcon",
				"userIcon",
			]);
		}
	}

	@validateArgs()
	public async sendReport(options: ZWavePlusCCReportOptions): Promise<void> {
		this.assertSupportsCommand(ZWavePlusCommand, ZWavePlusCommand.Report);

		const cc = new ZWavePlusCCReport({
			nodeId: this.endpoint.nodeId,
			endpointIndex: this.endpoint.index,
			...options,
		});
		await this.host.sendCommand(cc, this.commandOptions);
	}
}

@commandClass(CommandClasses["Z-Wave Plus Info"])
@implementedVersion(2)
@ccValues(ZWavePlusCCValues)
export class ZWavePlusCC extends CommandClass {
	declare ccCommand: ZWavePlusCommand;

	public async interview(
		ctx: InterviewContext,
	): Promise<void> {
		const node = this.getNode(ctx)!;
		const endpoint = this.getEndpoint(ctx)!;
		const api = CCAPI.create(
			CommandClasses["Z-Wave Plus Info"],
			ctx,
			endpoint,
		).withOptions({
			priority: MessagePriority.NodeQuery,
		});

		ctx.logNode(node.id, {
			endpoint: this.endpointIndex,
			message: `Interviewing ${this.ccName}...`,
			direction: "none",
		});

		ctx.logNode(node.id, {
			endpoint: this.endpointIndex,
			message: "querying Z-Wave+ information...",
			direction: "outbound",
		});

		const zwavePlusResponse = await api.get();
		if (zwavePlusResponse) {
			const logMessage = `received response for Z-Wave+ information:
Z-Wave+ version: ${zwavePlusResponse.zwavePlusVersion}
role type:       ${ZWavePlusRoleType[zwavePlusResponse.roleType]}
node type:       ${ZWavePlusNodeType[zwavePlusResponse.nodeType]}
installer icon:  ${num2hex(zwavePlusResponse.installerIcon)}
user icon:       ${num2hex(zwavePlusResponse.userIcon)}`;
			ctx.logNode(node.id, {
				endpoint: this.endpointIndex,
				message: logMessage,
				direction: "inbound",
			});
		}

		// Remember that the interview is complete
		this.setInterviewComplete(ctx, true);
	}
}

// @publicAPI
export interface ZWavePlusCCReportOptions {
	zwavePlusVersion: number;
	nodeType: ZWavePlusNodeType;
	roleType: ZWavePlusRoleType;
	installerIcon: number;
	userIcon: number;
}

@CCCommand(ZWavePlusCommand.Report)
@ccValueProperty("zwavePlusVersion", ZWavePlusCCValues.zwavePlusVersion)
@ccValueProperty("nodeType", ZWavePlusCCValues.nodeType)
@ccValueProperty("roleType", ZWavePlusCCValues.roleType)
@ccValueProperty("installerIcon", ZWavePlusCCValues.installerIcon)
@ccValueProperty("userIcon", ZWavePlusCCValues.userIcon)
export class ZWavePlusCCReport extends ZWavePlusCC {
	public constructor(
		options: WithAddress<ZWavePlusCCReportOptions>,
	) {
		super(options);
		this.zwavePlusVersion = options.zwavePlusVersion;
		this.roleType = options.roleType;
		this.nodeType = options.nodeType;
		this.installerIcon = options.installerIcon;
		this.userIcon = options.userIcon;
	}

	public static from(raw: CCRaw, ctx: CCParsingContext): ZWavePlusCCReport {
		validatePayload(raw.payload.length >= 7);
		const zwavePlusVersion = raw.payload[0];
		const roleType: ZWavePlusRoleType = raw.payload[1];
		const nodeType: ZWavePlusNodeType = raw.payload[2];
		const installerIcon = raw.payload.readUInt16BE(3);
		const userIcon = raw.payload.readUInt16BE(5);

		return new this({
			nodeId: ctx.sourceNodeId,
			zwavePlusVersion,
			roleType,
			nodeType,
			installerIcon,
			userIcon,
		});
	}

	public zwavePlusVersion: number;

	public nodeType: ZWavePlusNodeType;

	public roleType: ZWavePlusRoleType;

	public installerIcon: number;

	public userIcon: number;

	public serialize(ctx: CCEncodingContext): Promise<Bytes> {
		this.payload = Bytes.from([
			this.zwavePlusVersion,
			this.roleType,
			this.nodeType,
			// placeholder for icons
			0,
			0,
			0,
			0,
		]);
		this.payload.writeUInt16BE(this.installerIcon, 3);
		this.payload.writeUInt16BE(this.userIcon, 5);
		return super.serialize(ctx);
	}

	public toLogEntry(ctx?: GetValueDB): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(ctx),
			message: {
				version: this.zwavePlusVersion,
				"node type": getEnumMemberName(
					ZWavePlusNodeType,
					this.nodeType,
				),
				"role type": getEnumMemberName(
					ZWavePlusRoleType,
					this.roleType,
				),
				"icon (mgmt.)": num2hex(this.installerIcon),
				"icon (user)": num2hex(this.userIcon),
			},
		};
	}
}

@CCCommand(ZWavePlusCommand.Get)
@expectedCCResponse(ZWavePlusCCReport)
export class ZWavePlusCCGet extends ZWavePlusCC {}
