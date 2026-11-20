/*! \file pair_associative_container.hpp
    \brief Support for the PairAssociativeContainer refinement of the
    AssociativeContainer concept.
    \ingroup TypeConcepts */

#ifndef CEREAL_CONCEPTS_PAIR_ASSOCIATIVE_CONTAINER_HPP_
#define CEREAL_CONCEPTS_PAIR_ASSOCIATIVE_CONTAINER_HPP_

#include <cereal/cereal.hpp>

namespace cereal
{
  //! Saving for std-like pair associative containers
  template <class Archive, template <typename...> class Map, typename... Args, typename = typename Map<Args...>::mapped_type> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, Map<Args...> const & map )
  {
    ar( make_size_tag( static_cast<size_type>(map.size()) ) );

    for( const auto & i : map )
      ar( make_map_item(i.first, i.second) );
  }

  //! Loading for std-like pair associative containers
  template <class Archive, template <typename...> class Map, typename... Args, typename = typename Map<Args...>::mapped_type> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, Map<Args...> & map )
  {
    size_type size;
    ar( make_size_tag( size ) );

    map.clear();

    auto hint = map.begin();
    for( size_t i = 0; i < size; ++i )
    {
      typename Map<Args...>::key_type key;
      typename Map<Args...>::mapped_type value;

      ar( make_map_item(key, value) );
      #ifdef CEREAL_OLDER_GCC
      hint = map.insert( hint, std::make_pair(std::move(key), std::move(value)) );
      #else // NOT CEREAL_OLDER_GCC
      hint = map.emplace_hint( hint, std::move( key ), std::move( value ) );
      #endif // NOT CEREAL_OLDER_GCC
    }
  }
} // namespace cereal

#endif // CEREAL_CONCEPTS_PAIR_ASSOCIATIVE_CONTAINER_HPP_
