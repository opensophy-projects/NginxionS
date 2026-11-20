 

#ifndef __TABLE_OPAQUE_BASE_H__
#define __TABLE_OPAQUE_BASE_H__

#include <string>
#include <sys/types.h>

#include "cereal/types/common.hpp"
#include "cereal/types/string.hpp"
#include "cereal/types/vector.hpp"
#include "cereal/types/list.hpp"
#include "cereal/types/array.hpp"
#include "cereal/types/unordered_map.hpp"
#include "cereal/types/map.hpp"
#include "cereal/types/memory.hpp"
#include "cereal/types/chrono.hpp"

#include "cereal/archives/binary.hpp"

class TableOpaqueBase
{
public:
    TableOpaqueBase() {}
    virtual ~TableOpaqueBase() {}

    virtual void loadOpaque(cereal::BinaryInputArchive &, uint) = 0;
    virtual void saveOpaque(cereal::BinaryOutputArchive &, uint) = 0;

    virtual std::string nameOpaque() const = 0;

    virtual void uponEnteringContext() {}
    virtual void uponLeavingContext() {}
};

#endif // __TABLE_OPAQUE_BASE_H__
