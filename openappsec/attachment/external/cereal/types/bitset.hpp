/*! \file bitset.hpp
    \brief Support for types found in \<bitset\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_BITSET_HPP_
#define CEREAL_TYPES_BITSET_HPP_

#include <cereal/cereal.hpp>
#include <cereal/types/string.hpp>
#include <bitset>

namespace cereal
{
  namespace bitset_detail
  {
    //! The type the bitset is encoded with
    /*! @internal */
    enum class type : uint8_t
    {
      ulong,
      ullong,
      string,
      bits
    };
  }

  //! Serializing (save) for std::bitset when BinaryData optimization supported
  template <class Archive, size_t N,
            traits::EnableIf<traits::is_output_serializable<BinaryData<std::uint32_t>, Archive>::value>
            = traits::sfinae> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::bitset<N> const & bits )
  {
    ar( CEREAL_NVP_("type", bitset_detail::type::bits) );

    // Serialize 8 bit chunks
    std::uint8_t chunk = 0;
    std::uint8_t mask = 0x80;

    // Set each chunk using a rotating mask for the current bit
    for( std::size_t i = 0; i < N; ++i )
    {
      if( bits[i] )
        chunk |= mask;

      mask >>= 1;

      // output current chunk when mask is empty (8 bits)
      if( mask == 0 )
      {
        ar( chunk );
        chunk = 0;
        mask = 0x80;
      }
    }

    // serialize remainder, if it exists
    if( mask != 0x80 )
      ar( chunk );
  }

  //! Serializing (save) for std::bitset when BinaryData is not supported
  template <class Archive, size_t N,
            traits::DisableIf<traits::is_output_serializable<BinaryData<std::uint32_t>, Archive>::value>
            = traits::sfinae> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::bitset<N> const & bits )
  {
    try
    {
      auto const b = bits.to_ulong();
      ar( CEREAL_NVP_("type", bitset_detail::type::ulong) );
      ar( CEREAL_NVP_("data", b) );
    }
    catch( std::overflow_error const & )
    {
      try
      {
        auto const b = bits.to_ullong();
        ar( CEREAL_NVP_("type", bitset_detail::type::ullong) );
        ar( CEREAL_NVP_("data", b) );
      }
      catch( std::overflow_error const & )
      {
        ar( CEREAL_NVP_("type", bitset_detail::type::string) );
        ar( CEREAL_NVP_("data", bits.to_string()) );
      }
    }
  }

  //! Serializing (load) for std::bitset
  template <class Archive, size_t N> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::bitset<N> & bits )
  {
    bitset_detail::type t;
    ar( CEREAL_NVP_("type", t) );

    switch( t )
    {
      case bitset_detail::type::ulong:
      {
        unsigned long b;
        ar( CEREAL_NVP_("data", b) );
        bits = std::bitset<N>( b );
        break;
      }
      case bitset_detail::type::ullong:
      {
        unsigned long long b;
        ar( CEREAL_NVP_("data", b) );
        bits = std::bitset<N>( b );
        break;
      }
      case bitset_detail::type::string:
      {
        std::string b;
        ar( CEREAL_NVP_("data", b) );
        bits = std::bitset<N>( b );
        break;
      }
      case bitset_detail::type::bits:
      {
        // Normally we would use BinaryData to route this at compile time,
        // but doing this at runtime doesn't break any old serialization
        std::uint8_t chunk = 0;
        std::uint8_t mask  = 0;

        // Load one chunk at a time, rotating through the chunk
        // to set bits in the bitset
        for( std::size_t i = 0; i < N; ++i )
        {
          if( mask == 0 )
          {
            ar( chunk );
            mask = 0x80;
          }

          if( chunk & mask )
            bits[i] = 1;

          mask >>= 1;
        }
        break;
      }
      default:
        throw Exception("Invalid bitset data representation");
    }
  }
} // namespace cereal

#endif // CEREAL_TYPES_BITSET_HPP_
