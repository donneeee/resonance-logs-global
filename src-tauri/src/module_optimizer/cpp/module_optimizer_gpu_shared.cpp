#include "module_optimizer_gpu_shared.h"

#include <algorithm>

namespace ModuleOptimizerGpuShared {
namespace {
constexpr int kMaxSlotValue = 20;
constexpr int kMaxTotalAttrValue = 120;
}  // namespace

std::vector<int> BuildSlotValuePower(
    const std::unordered_set<int>& target_attributes,
    const std::unordered_set<int>& exclude_attributes) {
    std::vector<int> slot_value_power(Constants::CUDA_ATTR_DIM * 21, 0);
    for (int slot = 0; slot < Constants::CUDA_ATTR_DIM; ++slot) {
        const int attr_id = Constants::CUDA_SLOT_ATTR_IDS[slot];
        int multiplier = 1;
        if (attr_id != 0) {
            if (!target_attributes.empty() &&
                target_attributes.find(attr_id) != target_attributes.end()) {
                multiplier = 2;
            } else if (!exclude_attributes.empty() &&
                       exclude_attributes.find(attr_id) !=
                           exclude_attributes.end()) {
                multiplier = 0;
            }
        } else {
            multiplier = 0;
        }

        const auto& power_values = Constants::CUDA_SLOT_IS_SPECIAL[slot]
                                       ? Constants::SPECIAL_ATTR_POWER_VALUES
                                       : Constants::BASIC_ATTR_POWER_VALUES;
        for (int value = 0; value <= kMaxSlotValue; ++value) {
            int max_level = 0;
            for (int level = 0; level < 6; ++level) {
                if (value >= Constants::ATTR_THRESHOLDS[level]) {
                    max_level = level + 1;
                } else {
                    break;
                }
            }
            slot_value_power[slot * 21 + value] =
                (max_level > 0 ? power_values[max_level - 1] * multiplier : 0);
        }
    }
    return slot_value_power;
}

std::vector<int> BuildMinAttrRequirementsDense(
    const std::unordered_map<int, int>& min_attr_sum_requirements) {
    std::vector<int> min_attr_requirements(Constants::CUDA_ATTR_DIM, 0);
    for (const auto& kv : min_attr_sum_requirements) {
        auto slot_it = Constants::CUDA_ATTR_SLOT_MAP.find(kv.first);
        if (slot_it != Constants::CUDA_ATTR_SLOT_MAP.end()) {
            min_attr_requirements[slot_it->second] = kv.second;
        }
    }
    return min_attr_requirements;
}

std::vector<DenseModuleData> BuildDenseModuleData(
    const std::vector<ModuleInfo>& modules) {
    std::vector<DenseModuleData> dense_modules(modules.size());
    for (size_t module_idx = 0; module_idx < modules.size(); ++module_idx) {
        auto& dense = dense_modules[module_idx];
        for (const auto& part : modules[module_idx].parts) {
            const int part_value = std::max(0, part.value);
            auto slot_it = Constants::CUDA_ATTR_SLOT_MAP.find(part.id);
            if (slot_it != Constants::CUDA_ATTR_SLOT_MAP.end()) {
                dense.slot_values[slot_it->second] += part_value;
            }
            dense.total_attr_value += part_value;
        }
    }
    return dense_modules;
}

std::vector<int> BuildDenseModuleMatrix(
    const std::vector<DenseModuleData>& dense_modules) {
    std::vector<int> module_matrix(
        dense_modules.size() * static_cast<size_t>(Constants::CUDA_ATTR_DIM), 0);
    for (size_t module_idx = 0; module_idx < dense_modules.size();
         ++module_idx) {
        std::copy(
            dense_modules[module_idx].slot_values.begin(),
            dense_modules[module_idx].slot_values.end(),
            module_matrix.data() + module_idx * Constants::CUDA_ATTR_DIM);
    }
    return module_matrix;
}

std::vector<ModuleSolution> BuildGpuSolutions(
    const std::vector<ModuleInfo>& modules,
    int gpu_result_count,
    const std::vector<int>& gpu_scores,
    const std::vector<long long>& gpu_indices,
    int combination_size) {
    std::vector<ModuleSolution> final_solutions;
    final_solutions.reserve(std::max(0, gpu_result_count));

    for (int i = 0; i < gpu_result_count; ++i) {
        long long packed = gpu_indices[i];
        std::vector<ModuleInfo> solution_modules;
        solution_modules.reserve(static_cast<size_t>(combination_size));

        for (int j = 0; j < combination_size; ++j) {
            size_t module_idx =
                static_cast<size_t>((packed >> (j * 12)) & 0x0FFF);
            if (module_idx < modules.size()) {
                solution_modules.push_back(modules[module_idx]);
            }
        }

        auto result = ModuleOptimizerCpp::CalculateCombatPower(solution_modules);
        final_solutions.emplace_back(solution_modules, gpu_scores[i], result.second);
    }

    return final_solutions;
}

}  // namespace ModuleOptimizerGpuShared
