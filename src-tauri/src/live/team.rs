use crate::live::entity_id::{EntityUuid, canonical_player_uuid};
use crate::packets::opcodes::{GRPC_TEAM_NTF_SERVICE_ID, NotifyKey, grpc_team_method};
use blueprotobuf_lib::blueprotobuf;
use bytes::Bytes;
use prost::Message;
use std::collections::HashMap;

#[derive(Clone, PartialEq, Message)]
struct NoticeUpdateTeamInfo {
    #[prost(message, optional, tag = "1")]
    v_request: Option<NoticeUpdateTeamInfoRequest>,
}

#[derive(Clone, PartialEq, Message)]
struct NoticeUpdateTeamInfoRequest {
    #[prost(message, optional, tag = "1")]
    base_info: Option<TeamBaseInfo>,
}

#[derive(Clone, PartialEq, Message)]
struct NoticeUpdateTeamMemberInfo {
    #[prost(message, optional, tag = "1")]
    v_request: Option<NoticeUpdateTeamMemberInfoRequest>,
}

#[derive(Clone, PartialEq, Message)]
struct NoticeUpdateTeamMemberInfoRequest {
    #[prost(message, repeated, tag = "5")]
    team_member_sync_datas: Vec<TeamMemberFastSyncData>,
    #[prost(message, repeated, tag = "6")]
    team_member_social_datas: Vec<blueprotobuf::TeamMemData>,
}

#[derive(Clone, PartialEq, Message)]
struct NotifyJoinTeam {
    #[prost(message, optional, tag = "1")]
    v_request: Option<NotifyJoinTeamRequest>,
}

#[derive(Clone, PartialEq, Message)]
struct NotifyJoinTeamRequest {
    #[prost(message, optional, tag = "1")]
    base_info: Option<TeamBaseInfo>,
    #[prost(message, repeated, tag = "2")]
    member_data: Vec<blueprotobuf::TeamMemData>,
    #[prost(map = "int64, message", tag = "6")]
    member_sync_datas: HashMap<i64, TeamMemberFastSyncData>,
}

#[derive(Clone, PartialEq, Message)]
struct NotifyLeaveTeam {
    #[prost(message, optional, tag = "1")]
    v_request: Option<NotifyLeaveTeamRequest>,
}

#[derive(Clone, Copy, PartialEq, Message)]
struct NotifyLeaveTeamRequest {
    #[prost(int64, optional, tag = "1")]
    char_id: Option<i64>,
}

#[derive(Clone, PartialEq, Message)]
struct TeamBaseInfo {
    #[prost(int64, optional, tag = "1")]
    team_id: Option<i64>,
    #[prost(int64, optional, tag = "3")]
    leader_id: Option<i64>,
}

#[derive(Clone, Copy, PartialEq, Message)]
struct TeamMemberFastSyncData {
    #[prost(int64, optional, tag = "1")]
    char_id: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TeamRuntimeState {
    pub team_id: i64,
    pub leader_uuid: EntityUuid,
    pub members: Vec<EntityUuid>,
}

impl TeamRuntimeState {
    pub fn apply_event(&mut self, event: TeamEvent, local_player_uuid: EntityUuid) {
        match event {
            TeamEvent::TeamInfoUpdated {
                team_id,
                leader_uuid,
            } => {
                self.team_id = team_id;
                self.leader_uuid = leader_uuid;
                self.add_member(leader_uuid);
            }
            TeamEvent::MemberInfoUpdated { members, .. } => {
                self.upsert_members(members);
            }
            TeamEvent::Joined {
                team_id,
                leader_uuid,
                members,
                ..
            } => {
                self.team_id = team_id;
                self.leader_uuid = leader_uuid;
                self.set_members(members);
                self.add_member(leader_uuid);
            }
            TeamEvent::Left { member_uuid } => {
                if member_uuid != 0 && member_uuid == local_player_uuid {
                    self.clear();
                } else {
                    self.remove_member(member_uuid);
                }
            }
            TeamEvent::Dissolved => self.clear(),
        }
    }

    fn set_members<I>(&mut self, members: I)
    where
        I: IntoIterator<Item = EntityUuid>,
    {
        self.members.clear();
        self.upsert_members(members);
    }

    fn upsert_members<I>(&mut self, members: I)
    where
        I: IntoIterator<Item = EntityUuid>,
    {
        for member_id in members {
            self.add_member(member_id);
        }
    }

    fn add_member(&mut self, member_id: EntityUuid) {
        if member_id != 0 && !self.members.contains(&member_id) {
            self.members.push(member_id);
        }
    }

    fn remove_member(&mut self, member_id: EntityUuid) {
        self.members.retain(|existing| *existing != member_id);
    }

    fn clear(&mut self) {
        *self = Self::default();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamEvent {
    TeamInfoUpdated {
        team_id: i64,
        leader_uuid: EntityUuid,
    },
    MemberInfoUpdated {
        members: Vec<EntityUuid>,
        equipment: Vec<TeamMemberEquipment>,
    },
    Joined {
        team_id: i64,
        leader_uuid: EntityUuid,
        members: Vec<EntityUuid>,
        equipment: Vec<TeamMemberEquipment>,
    },
    Left {
        member_uuid: EntityUuid,
    },
    Dissolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamMemberEquipment {
    pub member_uuid: EntityUuid,
    pub runtime_source: &'static str,
    pub items: Vec<TeamEquipmentItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TeamEquipmentItem {
    pub slot: i32,
    pub item_config_id: i32,
}

pub fn decode_team_event(key: NotifyKey, data: Bytes) -> Option<TeamEvent> {
    if key.service_id != GRPC_TEAM_NTF_SERVICE_ID {
        return None;
    }

    match key.method_id {
        grpc_team_method::NOTICE_UPDATE_TEAM_INFO => match NoticeUpdateTeamInfo::decode(data) {
            Ok(message) => {
                message
                    .v_request
                    .and_then(|request| request.base_info)
                    .map(|base_info| TeamEvent::TeamInfoUpdated {
                        team_id: base_info.team_id.unwrap_or_default(),
                        leader_uuid: canonical_player_uuid(base_info.leader_id.unwrap_or_default()),
                    })
            }
            Err(err) => {
                log::warn!("Error decoding NoticeUpdateTeamInfo.. ignoring: {err}");
                None
            }
        },
        grpc_team_method::NOTICE_UPDATE_TEAM_MEMBER_INFO => {
            match NoticeUpdateTeamMemberInfo::decode(data) {
                Ok(message) => message.v_request.map(|request| {
                    let mut members = Vec::new();
                    let mut equipment = Vec::new();
                    for member in request.team_member_social_datas {
                        push_member_id(&mut members, member.char_id);
                        push_member_equipment(
                            &mut equipment,
                            &member,
                            "GrpcTeamNtf.NoticeUpdateTeamMemberInfo.social_data.equip_data",
                        );
                    }
                    for member in request.team_member_sync_datas {
                        push_member_id(&mut members, member.char_id);
                    }
                    TeamEvent::MemberInfoUpdated { members, equipment }
                }),
                Err(err) => {
                    log::warn!("Error decoding NoticeUpdateTeamMemberInfo.. ignoring: {err}");
                    None
                }
            }
        }
        grpc_team_method::NOTIFY_JOIN_TEAM => match NotifyJoinTeam::decode(data) {
            Ok(message) => message.v_request.and_then(|request| {
                let base_info = request.base_info?;
                let mut members = Vec::new();
                let mut equipment = Vec::new();
                for member in request.member_data {
                    push_member_id(&mut members, member.char_id);
                    push_member_equipment(
                        &mut equipment,
                        &member,
                        "GrpcTeamNtf.NotifyJoinTeam.member_data.social_data.equip_data",
                    );
                }
                let mut sync_members: Vec<_> = request.member_sync_datas.into_iter().collect();
                sync_members.sort_by_key(|(char_id, _)| *char_id);
                for (char_id, member) in sync_members {
                    push_member_id(&mut members, Some(char_id));
                    push_member_id(&mut members, member.char_id);
                }
                Some(TeamEvent::Joined {
                    team_id: base_info.team_id.unwrap_or_default(),
                    leader_uuid: canonical_player_uuid(base_info.leader_id.unwrap_or_default()),
                    members,
                    equipment,
                })
            }),
            Err(err) => {
                log::warn!("Error decoding NotifyJoinTeam.. ignoring: {err}");
                None
            }
        },
        grpc_team_method::NOTIFY_LEAVE_TEAM => match NotifyLeaveTeam::decode(data) {
            Ok(message) => message.v_request.map(|request| TeamEvent::Left {
                member_uuid: canonical_player_uuid(request.char_id.unwrap_or_default()),
            }),
            Err(err) => {
                log::warn!("Error decoding NotifyLeaveTeam.. ignoring: {err}");
                None
            }
        },
        grpc_team_method::NOTICE_TEAM_DISSOLVE => Some(TeamEvent::Dissolved),
        grpc_team_method::NOTIFY_BE_TRANSFER_LEADER => {
            log::debug!(
                "GrpcTeamNtf NotifyBeTransferLeader received; state decode not implemented"
            );
            None
        }
        method_id => {
            log::trace!("Unhandled GrpcTeamNtf method_id={method_id}");
            None
        }
    }
}

fn push_member_id(members: &mut Vec<EntityUuid>, member_id: Option<i64>) {
    if let Some(member_id) = member_id {
        if member_id != 0 {
            let member_uuid = canonical_player_uuid(member_id);
            if !members.contains(&member_uuid) {
                members.push(member_uuid);
            }
        }
    }
}

fn push_member_equipment(
    equipment: &mut Vec<TeamMemberEquipment>,
    member: &blueprotobuf::TeamMemData,
    runtime_source: &'static str,
) {
    let member_uuid = canonical_player_uuid(member.char_id.unwrap_or_default());
    if member_uuid == 0 {
        return;
    }

    let Some(equip_data) = member
        .social_data
        .as_ref()
        .and_then(|data| data.equip_data.as_ref())
    else {
        return;
    };

    let mut items: Vec<_> = equip_data
        .equip_infos
        .iter()
        .filter_map(|item| {
            let slot = item.slot.filter(|slot| *slot > 0)?;
            let item_config_id = item.equip_id.filter(|equip_id| *equip_id > 0)?;
            Some(TeamEquipmentItem {
                slot,
                item_config_id,
            })
        })
        .collect();

    if items.is_empty() {
        return;
    }

    items.sort_by_key(|item| (item.slot, item.item_config_id));

    if let Some(existing) = equipment
        .iter_mut()
        .find(|existing| existing.member_uuid == member_uuid)
    {
        existing.runtime_source = runtime_source;
        existing.items = items;
    } else {
        equipment.push(TeamMemberEquipment {
            member_uuid,
            runtime_source,
            items,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(char_id: i64) -> EntityUuid {
        canonical_player_uuid(char_id)
    }

    #[test]
    fn joined_sets_members_and_includes_leader() {
        let mut state = TeamRuntimeState::default();

        state.apply_event(
            TeamEvent::Joined {
                team_id: 7,
                leader_uuid: c(2),
                members: vec![c(1), 0, c(1)],
                equipment: Vec::new(),
            },
            c(1),
        );

        assert_eq!(state.team_id, 7);
        assert_eq!(state.leader_uuid, c(2));
        assert_eq!(state.members, vec![c(1), c(2)]);
    }

    #[test]
    fn member_updates_are_upserted_and_deduped() {
        let mut state = TeamRuntimeState {
            team_id: 7,
            leader_uuid: c(1),
            members: vec![c(1), c(2)],
        };

        state.apply_event(
            TeamEvent::MemberInfoUpdated {
                members: vec![c(2), c(3), 0, c(3)],
                equipment: Vec::new(),
            },
            c(1),
        );

        assert_eq!(state.members, vec![c(1), c(2), c(3)]);
    }

    #[test]
    fn leave_removes_member_and_local_leave_clears_state() {
        let mut state = TeamRuntimeState {
            team_id: 7,
            leader_uuid: c(1),
            members: vec![c(1), c(2), c(3)],
        };

        state.apply_event(TeamEvent::Left { member_uuid: c(2) }, c(1));

        assert_eq!(state.members, vec![c(1), c(3)]);

        state.apply_event(TeamEvent::Left { member_uuid: c(1) }, c(1));

        assert_eq!(state, TeamRuntimeState::default());
    }

    #[test]
    fn dissolve_clears_state() {
        let mut state = TeamRuntimeState {
            team_id: 7,
            leader_uuid: c(1),
            members: vec![c(1), c(2), c(3)],
        };

        state.apply_event(TeamEvent::Dissolved, c(1));

        assert_eq!(state, TeamRuntimeState::default());
    }

    #[test]
    fn decode_member_update_extracts_social_and_sync_member_ids() {
        let message = NoticeUpdateTeamMemberInfo {
            v_request: Some(NoticeUpdateTeamMemberInfoRequest {
                team_member_social_datas: vec![
                    blueprotobuf::TeamMemData {
                        char_id: Some(10),
                        ..Default::default()
                    },
                    blueprotobuf::TeamMemData {
                        char_id: Some(20),
                        ..Default::default()
                    },
                ],
                team_member_sync_datas: vec![
                    TeamMemberFastSyncData {
                        char_id: Some(20),
                        ..Default::default()
                    },
                    TeamMemberFastSyncData {
                        char_id: Some(0),
                        ..Default::default()
                    },
                ],
            }),
        };

        let event = decode_team_event(
            NotifyKey {
                service_id: GRPC_TEAM_NTF_SERVICE_ID,
                method_id: grpc_team_method::NOTICE_UPDATE_TEAM_MEMBER_INFO,
            },
            Bytes::from(message.encode_to_vec()),
        );

        assert_eq!(
            event,
            Some(TeamEvent::MemberInfoUpdated {
                members: vec![c(10), c(20)],
                equipment: Vec::new(),
            })
        );
    }

    #[test]
    fn decode_member_update_extracts_social_equipment() {
        let message = NoticeUpdateTeamMemberInfo {
            v_request: Some(NoticeUpdateTeamMemberInfoRequest {
                team_member_social_datas: vec![blueprotobuf::TeamMemData {
                    char_id: Some(10),
                    social_data: Some(blueprotobuf::TeamMemberSocialData {
                        equip_data: Some(blueprotobuf::EquipData {
                            equip_infos: vec![blueprotobuf::EquipNine {
                                slot: Some(200),
                                equip_id: Some(2000626),
                            }],
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
        };

        let event = decode_team_event(
            NotifyKey {
                service_id: GRPC_TEAM_NTF_SERVICE_ID,
                method_id: grpc_team_method::NOTICE_UPDATE_TEAM_MEMBER_INFO,
            },
            Bytes::from(message.encode_to_vec()),
        );

        assert_eq!(
            event,
            Some(TeamEvent::MemberInfoUpdated {
                members: vec![c(10)],
                equipment: vec![TeamMemberEquipment {
                    member_uuid: c(10),
                    runtime_source: "GrpcTeamNtf.NoticeUpdateTeamMemberInfo.social_data.equip_data",
                    items: vec![TeamEquipmentItem {
                        slot: 200,
                        item_config_id: 2000626,
                    }],
                }],
            })
        );
    }

    #[test]
    fn decode_join_team_merges_member_sources_in_stable_order() {
        let mut member_sync_datas = HashMap::new();
        member_sync_datas.insert(
            30,
            TeamMemberFastSyncData {
                char_id: None,
                ..Default::default()
            },
        );
        member_sync_datas.insert(
            20,
            TeamMemberFastSyncData {
                char_id: Some(25),
                ..Default::default()
            },
        );
        let message = NotifyJoinTeam {
            v_request: Some(NotifyJoinTeamRequest {
                base_info: Some(TeamBaseInfo {
                    team_id: Some(7),
                    leader_id: Some(10),
                    ..Default::default()
                }),
                member_data: vec![blueprotobuf::TeamMemData {
                    char_id: Some(10),
                    ..Default::default()
                }],
                member_sync_datas,
                ..Default::default()
            }),
        };

        let event = decode_team_event(
            NotifyKey {
                service_id: GRPC_TEAM_NTF_SERVICE_ID,
                method_id: grpc_team_method::NOTIFY_JOIN_TEAM,
            },
            Bytes::from(message.encode_to_vec()),
        );

        assert_eq!(
            event,
            Some(TeamEvent::Joined {
                team_id: 7,
                leader_uuid: c(10),
                members: vec![c(10), c(20), c(25), c(30)],
                equipment: Vec::new(),
            })
        );
    }
}
