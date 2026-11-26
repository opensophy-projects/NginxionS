// NginxionS: account actions follow the current role and the target account.
import {
	IconDotsVertical,
	IconEdit,
	IconLock,
	IconLogin2,
	IconPower,
	IconShield,
	IconTrash,
} from "@tabler/icons-react";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo } from "react";
import type { User } from "src/api/backend";
import {
	EmailFormatter,
	EmptyData,
	GravatarFormatter,
	TrueFalseFormatter,
	ValueWithDateFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { UserRoleBadges } from "src/nginxions/rbac/UserRoleBadges";

interface Props {
	data: User[];
	isFiltered?: boolean;
	isFetching?: boolean;
	currentUserId?: number;
	admin?: boolean;
	manageUsers?: boolean;
	manageRoles?: boolean;
	onEditUser?: (id: number) => void;
	onEditPermissions?: (id: number) => void;
	onSetPassword?: (id: number) => void;
	onDeleteUser?: (id: number) => void;
	onDisableToggle?: (id: number, enabled: boolean) => void;
	onNewUser?: () => void;
	onLoginAs?: (id: number) => void;
}
export default function Table({
	data,
	isFiltered,
	isFetching,
	currentUserId,
	admin,
	manageUsers,
	manageRoles,
	onEditUser,
	onEditPermissions,
	onSetPassword,
	onDeleteUser,
	onDisableToggle,
	onNewUser,
	onLoginAs,
}: Props) {
	const columnHelper = createColumnHelper<User>();
	const columns = useMemo(
		() => [
			columnHelper.accessor((row: any) => row.name, {
				id: "avatar",
				cell: (info: any) => {
					const value = info.row.original;
					return <GravatarFormatter url={value.avatar} name={value.name} />;
				},
				meta: {
					className: "w-1",
				},
			}),
			columnHelper.accessor((row: any) => row.name, {
				id: "name",
				header: intl.formatMessage({ id: "column.name" }),
				cell: (info: any) => {
					const value = info.row.original;
					// Hack to reuse domains formatter
					return (
						<ValueWithDateFormatter
							value={value.name}
							createdOn={value.createdOn}
							disabled={value.isDisabled}
						/>
					);
				},
			}),
			columnHelper.accessor((row: any) => row.email, {
				id: "email",
				header: intl.formatMessage({ id: "column.email" }),
				cell: (info: any) => {
					return <EmailFormatter email={info.getValue()} />;
				},
			}),
			columnHelper.accessor((row: any) => row.roles.join(", "), {
				id: "roles",
				header: intl.formatMessage({ id: "column.roles" }),
				cell: (info: any) => {
					// NginxionS: the roles of NginxionS instead of admin / standard user
					return <UserRoleBadges userId={info.row.original.id} />;
				},
			}),
			columnHelper.accessor((row: any) => row.isDisabled, {
				id: "isDisabled",
				header: intl.formatMessage({ id: "column.status" }),
				cell: (info: any) => {
					return <TrueFalseFormatter value={!info.getValue()} />;
				},
			}),
			columnHelper.accessor((row: any) => row.id, {
				id: "id",
				header: "ID",
				cell: (info: any) => info.getValue(),
				meta: {
					className: "text-end w-1",
				},
			}),
			columnHelper.display({
				id: "actions",
				cell: ({ row: { original: user } }) => {
					const own = currentUserId === user.id;
					const canManage = admin || (manageUsers && !user.roles.includes("admin"));
					const canAssign = !own && manageRoles && (admin || !user.roles.includes("admin"));
					if (!own && !canManage && !canAssign) return null;
					return (
						<span className="dropdown">
							<button
								type="button"
								aria-label={intl.formatMessage(
									{ id: "object.actions-title" },
									{ object: intl.formatMessage({ id: "user" }), id: user.id },
								)}
								className="btn dropdown-toggle btn-action btn-sm px-1"
								data-bs-boundary="viewport"
								data-bs-toggle="dropdown"
							>
								<IconDotsVertical />
							</button>
							<div className="dropdown-menu dropdown-menu-end">
								{(own || canManage) && (
									<button
										type="button"
										className="dropdown-item"
										onClick={() => onEditUser?.(user.id)}
									>
										<IconEdit size={16} />
										<T id="action.edit" />
									</button>
								)}
								{canAssign && (
									<button
										type="button"
										className="dropdown-item"
										onClick={() => onEditPermissions?.(user.id)}
									>
										<IconShield size={16} />
										<T id="action.permissions" />
									</button>
								)}
								{!own && canManage && (
									<>
										<button
											type="button"
											className="dropdown-item"
											onClick={() => onSetPassword?.(user.id)}
										>
											<IconLock size={16} />
											<T id="user.set-password" />
										</button>
										<button
											type="button"
											className="dropdown-item"
											onClick={() => onDisableToggle?.(user.id, user.isDisabled)}
										>
											<IconPower size={16} />
											<T id={user.isDisabled ? "action.enable" : "action.disable"} />
										</button>
										{admin && (
											<button
												type="button"
												className="dropdown-item"
												disabled={user.isDisabled}
												onClick={() => onLoginAs?.(user.id)}
											>
												<IconLogin2 size={16} />
												<T id="user.login-as" data={{ name: user.name }} />
											</button>
										)}
										<div className="dropdown-divider" />
										<button
											type="button"
											className="dropdown-item"
											onClick={() => onDeleteUser?.(user.id)}
										>
											<IconTrash size={16} />
											<T id="action.delete" />
										</button>
									</>
								)}
							</div>
						</span>
					);
				},
				meta: {
					className: "text-end w-1",
				},
			}),
		],
		[
			columnHelper,
			currentUserId,
			admin,
			manageUsers,
			manageRoles,
			onEditUser,
			onDisableToggle,
			onDeleteUser,
			onEditPermissions,
			onSetPassword,
			onLoginAs,
		],
	);

	const tableInstance = useReactTable<User>({
		columns,
		data,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		rowCount: data.length,
		meta: {
			isFetching,
		},
		enableSortingRemoval: false,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					object="user"
					objects="users"
					tableInstance={tableInstance}
					onNew={manageUsers ? onNewUser : undefined}
					isFiltered={isFiltered}
					color="orange"
				/>
			}
		/>
	);
}
